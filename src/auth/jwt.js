import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signAccess(payload) {
  return jwt.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessTtl });
}
export function signRefresh(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshTtl });
}
export function verifyAccess(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}
export function verifyRefresh(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}
