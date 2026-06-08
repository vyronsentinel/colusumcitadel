import { authenticator } from 'otplib';
import { config } from '../config.js';

export function generateSecret() {
  return authenticator.generateSecret();
}

export function otpauthUrl(email, secret) {
  return authenticator.keyuri(email, config.totpIssuer, secret);
}

export function verifyToken(token, secret) {
  try {
    return authenticator.verify({ token: String(token || ''), secret });
  } catch {
    return false;
  }
}
