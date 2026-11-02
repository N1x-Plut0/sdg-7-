// Netlify function: POST /api/admin, the leaderboard admin panel (admin.html).
// It works only after you set ADMIN_PASSWORD in Netlify → Project configuration → Environment variables.
import { getStore } from '@netlify/blobs';
import { handleAdmin } from '../board-core.mjs';

export default async (req) => handleAdmin(req, getStore({ name: 'light-dash-board', consistency: 'strong' }), process.env.ADMIN_PASSWORD || '');

export const config = { path: '/api/admin' };
