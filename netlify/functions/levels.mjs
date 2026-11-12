// Netlify function: /api/levels, the community levels catalogue.
// GET lists or loads levels; POST publishes, likes, counts a play or deletes.
import { getStore } from '@netlify/blobs';
import { handleLevels } from '../board-core.mjs';

export default async (req) => handleLevels(req,
  getStore({ name: 'light-dash-board', consistency: 'strong' }),
  getStore({ name: 'light-dash-levels', consistency: 'strong' }));

export const config = { path: '/api/levels' };
