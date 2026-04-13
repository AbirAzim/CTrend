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
import { randomBytes } from 'crypto';
import { UserDocument } from '../users/user.schema';
import { UsersService, normalizeEmail } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

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
    });
    return this.toAuthPayload(user);
  }

  async signup(email: string, password: string, displayName?: string) {
    const normalized = normalizeEmail(email);
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const existing = await this.usersService.findByEmail(normalized);
    if (existing) throw new ConflictException('Email already registered');
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
    });
    return this.toAuthPayload(user);
  }

  async login(email: string, password: string) {
    const normalized = normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalized);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
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
      const ticket = await client.verifyIdToken({
        idToken,
        audience,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Invalid Google token');
    }
    const sub = payload.sub;
    const email = normalizeEmail(payload.email);
    if (payload.email_verified === false) {
      throw new UnauthorizedException('Google email not verified');
    }

    let user = await this.usersService.findByGoogleSub(sub);
    if (user) {
      await this.syncGoogleProfile(user, payload.name, payload.picture);
      const fresh = await this.usersService.findById(user._id.toHexString());
      return this.toAuthPayload(fresh!);
    }

    const byEmail = await this.usersService.findByEmail(email);
    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== sub) {
        throw new ConflictException(
          'Account exists with a different Google login',
        );
      }
      byEmail.googleSub = sub;
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
    });
    return this.toAuthPayload(created);
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
    const accessToken = this.signToken(user._id.toHexString());
    return {
      accessToken,
      refreshToken: null as string | null,
      user: this.usersService.toGql(user),
    };
  }

  private signToken(sub: string) {
    return this.jwtService.sign({ sub });
  }
}
