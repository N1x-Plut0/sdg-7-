// Netlify function: GET /api/leaderboard (top players) and POST /api/leaderboard (save your score).
// Scores live in Netlify Blobs, which every Netlify site has without extra setup.
import { getStore } from '@netlify/blobs';
import { handle } from '../board-core.mjs';

export default async (req) => handle(req, getStore({ name: 'light-dash-board', consistency: 'strong' }));

export const config = { path: '/api/leaderboard' };
