// Netlify function: POST /api/admin, the admin panel (admin.html): players, accounts and community levels.
// Admin accounts log in with their own key; ADMIN_PASSWORD in Netlify is an optional backup.
import { getStore } from '@netlify/blobs';
import { handleAdmin } from '../board-core.mjs';

export default async (req) => handleAdmin(req,
  getStore({ name: 'light-dash-board', consistency: 'strong' }), process.env.ADMIN_PASSWORD || '',
  getStore({ name: 'light-dash-levels', consistency: 'strong' }),
  getStore({ name: 'light-dash-accounts', consistency: 'strong' }));

export const config = { path: '/api/admin' };
