'use strict';

const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client();

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeCompare(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

async function verifyGoogleCredential(credential, clientId) {
  if (!clientId) {
    throw httpError(503, 'Google sign-in is not configured on this server.');
  }
  if (!credential || typeof credential !== 'string') {
    throw httpError(400, 'Missing Google sign-in credential.');
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
  } catch {
    throw httpError(401, 'Google sign-in could not be verified. Please try again.');
  }

  const payload = ticket.getPayload();
  const emailVerified = payload?.email_verified === true || payload?.email_verified === 'true';
  if (!payload?.email || !emailVerified) {
    throw httpError(401, 'Your Google account email is not verified.');
  }

  return {
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || payload.email.split('@')[0]).trim().slice(0, 255),
    emailDomain: String(payload.email).split('@').pop().toLowerCase(),
  };
}

function createLoadEmployee(db) {
  return async function loadEmployee(req, res, next) {
    if (!req.session || !req.session.employeeId) return next();
    try {
      const employee = await db('employees').where({ id: req.session.employeeId }).first();
      if (employee && employee.active) {
        req.employee = employee;
      } else {
        delete req.session.employeeId;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireEmployee(req, res, next) {
  if (!req.employee) {
    return res.status(401).json({ error: 'Please sign in with your Google account first.' });
  }
  next();
}

function adminIsAuthenticated(req, config) {
  if (!req.session || !req.session.adminAt) return false;
  const age = Date.now() - Number(req.session.adminAt);
  if (!Number.isFinite(age) || age < 0 || age > config.adminSessionMs) {
    delete req.session.adminAt;
    return false;
  }
  return true;
}

function requireAdmin(config) {
  return function adminGuard(req, res, next) {
    if (!adminIsAuthenticated(req, config)) {
      return res.status(401).json({ error: 'Admin sign-in required.' });
    }
    next();
  };
}

module.exports = {
  httpError,
  safeCompare,
  verifyGoogleCredential,
  createLoadEmployee,
  requireEmployee,
  adminIsAuthenticated,
  requireAdmin,
};
