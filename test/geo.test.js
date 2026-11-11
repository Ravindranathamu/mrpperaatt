'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { distanceMeters } = require('../src/geo');

test('Haversine distance is accurate for short office-scale distances', () => {
  const officeLat = 6.9271;
  const officeLng = 79.8612;
  assert.ok(distanceMeters(officeLat, officeLng, officeLat, officeLng) < 0.001);
  const fiftyMetresNorth = officeLat + 0.00044966; // roughly 50 m
  const distance = distanceMeters(officeLat, officeLng, fiftyMetresNorth, officeLng);
  assert.ok(distance > 48 && distance < 52, `expected about 50m, got ${distance}`);
});

test('invalid coordinates fail closed', () => {
  assert.equal(distanceMeters(91, 0, 0, 0), Number.POSITIVE_INFINITY);
  assert.equal(distanceMeters('x', 0, 0, 0), Number.POSITIVE_INFINITY);
});
