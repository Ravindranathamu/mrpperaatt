// Netlify Server entry point.
//
// Netlify runs this as a long-lived Node.js process (not a serverless
// function), so the Express app, its connection pool, and its signed-cookie
// sessions behave exactly as they do locally. The app is wrapped in a plain
// HTTP server instead of calling app.listen(); Netlify supplies the port and
// routes requests to the exported server.
//
// Database migrations and department seeding happen lazily on the first API
// request. /api/ping never touches the database, so an uptime monitor can use
// it without waking Neon.

import { createServer } from 'node:http';
import serverModule from '../../server.js';

const app = serverModule.app;

export default createServer(app);
