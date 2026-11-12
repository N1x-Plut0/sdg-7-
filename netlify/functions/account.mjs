// Netlify function: POST /api/account — register, log in, cloud save and load, change password.
import { getStore } from '@netlify/blobs';
import { handleAccount } from '../board-core.mjs';

export default async (req) => handleAccount(req,
  getStore({ name: 'light-dash-board', consistency: 'strong' }),
  getStore({ name: 'light-dash-accounts', consistency: 'strong' }));

export const config = { path: '/api/account' };
