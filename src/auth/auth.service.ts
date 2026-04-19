import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { UserDocument } from '../users/user.schema';
import { UsersService, normalizeEmail } from '../users/users.service';
import { MailService } from '../mail/mail.service';

const OTP_TTL_MS = 15 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailService: MailService,
  ) {}

  /** Legacy signup: username + email + password. Returns tokens immediately. */
  async register(
    username: string,
    email: string,
    password: string,
    interests?: string[],
  ) {
    const normalized = normalizeEmail(email);
    const existing = await this.usersService.findByEmail(normalized);
    if (existing) throw new ConflictException('Email already registered');
    const hash = await bcrypt.hash(password, 10);
    const user = await this.usersService.create({
      username,
      email: normalized,
      password: hash,
      interests,
      displayName: username,
      emailVerified: true,
    });
    return this.toAuthPayload(user);
  }

  /**
   * New signup flow: creates a pending (unverified) account and emails a 6-digit OTP.
   * Returns true on success. Tokens are issued by verifyEmail() instead.
   */
  async signup(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<boolean> {
    const normalized = normalizeEmail(email);
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const existing = await this.usersService.findByEmail(normalized);
    if (existing) {
      if (!existing.emailVerified) {
        // Re-send OTP rather than erroring so users who mis-typed can retry.
        await this.sendOtp(existing);
        return true;
      }
      throw new ConflictException('Email already registered');
    }
    const local = normalized.split('@')[0] || 'user';
    const username = await this.usersService.ensureUniqueUsername(
      displayName || local,
    );
    const hash = await bcrypt.hash(password, 10);
    const user = await this.usersService.create({
      username,
      email: normalized,
      password: hash,
      displayName: displayName?.trim() || undefined,
      emailVerified: false,
    });
    await this.sendOtp(user);
    return true;
  }

  async verifyEmail(email: string, code: string) {
    const normalized = normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalized);
    if (!user) throw new BadRequestException('Invalid or expired code');
    if (user.emailVerified) throw new BadRequestException('Email already verified');
    if (
      !user.emailVerificationCode ||
      !user.emailVerificationExpiry ||
      user.emailVerificationExpiry < new Date()
    ) {
      throw new BadRequestException('Verification code expired — request a new one');
    }
    const match = await bcrypt.compare(code, user.emailVerificationCode);
    if (!match) throw new BadRequestException('Invalid or expired code');

    user.emailVerified = true;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpiry = undefined;
    await user.save();
    return this.toAuthPayload(user);
  }

  async resendVerificationEmail(email: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalized);
    if (!user || user.emailVerified) return true; // silent no-op to prevent enumeration
    await this.sendOtp(user);
    return true;
  }

  async requestPasswordReset(email: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalized);
    // Always return true to prevent email enumeration.
    if (!user) return true;

    const token = randomBytes(32).toString('hex');
    // SHA-256 hash for deterministic DB lookup; bcrypt salts prevent direct match.
    user.passwordResetToken = sha256(token);
    user.passwordResetExpiry = new Date(Date.now() + RESET_TTL_MS);
    await user.save();

    const frontend = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontend}/reset-password?token=${token}`;
    await this.mailService.sendPasswordResetLink(normalized, resetUrl);
    return true;
  }

  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const user = await this.usersService.findByPasswordResetToken(sha256(token));
    if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpiry = undefined;
    await user.save();
    return true;
  }

  async login(email: string, password: string) {
    const normalized = normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalized);
    if (!user) throw new UnauthorizedException('Invalid email or password');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    if (!user.emailVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }
    return this.toAuthPayload(user);
  }

  async googleLogin(idToken: string) {
    const audience = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!audience?.trim()) {
      throw new BadRequestException('Google OAuth not configured');
    }
    const client = new OAuth2Client(audience);
    let payload: TokenPayload | undefined;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Invalid Google token');
    }
    if (payload.email_verified === false) {
      throw new UnauthorizedException('Google email not verified');
    }
    const sub = payload.sub;
    const email = normalizeEmail(payload.email);

    let user = await this.usersService.findByGoogleSub(sub);
    if (user) {
      await this.syncGoogleProfile(user, payload.name, payload.picture);
      const fresh = await this.usersService.findById(user._id.toHexString());
      return this.toAuthPayload(fresh!);
    }

    const byEmail = await this.usersService.findByEmail(email);
    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== sub) {
        throw new ConflictException('Account exists with a different Google login');
      }
      byEmail.googleSub = sub;
      byEmail.emailVerified = true;
      if (payload.name?.trim()) byEmail.displayName = payload.name.trim();
      if (payload.picture) byEmail.profileImageUrl = payload.picture;
      await byEmail.save();
      return this.toAuthPayload(byEmail);
    }

    const username = await this.usersService.ensureUniqueUsername(
      payload.name || email.split('@')[0] || 'user',
    );
    const randomPass = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const created = await this.usersService.create({
      username,
      email,
      password: randomPass,
      googleSub: sub,
      displayName: payload.name?.trim() || undefined,
      profileImageUrl: payload.picture,
      emailVerified: true,
    });
    return this.toAuthPayload(created);
  }

  private async sendOtp(user: UserDocument): Promise<void> {
    const code = String(randomInt(100000, 999999));
    const codeHash = await bcrypt.hash(code, 10);
    user.emailVerificationCode = codeHash;
    user.emailVerificationExpiry = new Date(Date.now() + OTP_TTL_MS);
    await user.save();
    await this.mailService.sendVerificationCode(user.email, code);
  }

  private async syncGoogleProfile(
    user: UserDocument,
    name?: string | null,
    picture?: string | null,
  ) {
    let dirty = false;
    if (name?.trim() && !user.displayName) {
      user.displayName = name.trim();
      dirty = true;
    }
    if (picture && !user.profileImageUrl) {
      user.profileImageUrl = picture;
      dirty = true;
    }
    if (dirty) await user.save();
  }

  private toAuthPayload(user: UserDocument) {
    return {
      accessToken: this.jwtService.sign({ sub: user._id.toHexString() }),
      refreshToken: null as string | null,
      user: this.usersService.toGql(user),
    };
  }
}
