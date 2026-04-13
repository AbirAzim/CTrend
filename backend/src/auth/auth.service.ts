import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async register(
    username: string,
    email: string,
    password: string,
    interests?: string[],
  ) {
    const existing = await this.usersService.findByEmail(email);
    if (existing) throw new ConflictException('Email already registered');
    const hash = await bcrypt.hash(password, 10);
    const user = await this.usersService.create({
      username,
      email,
      password: hash,
      interests,
    });
    const accessToken = this.signToken(user._id.toHexString());
    return { accessToken, user: this.usersService.toGql(user) };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    const accessToken = this.signToken(user._id.toHexString());
    return { accessToken, user: this.usersService.toGql(user) };
  }

  private signToken(sub: string) {
    return this.jwtService.sign({ sub });
  }
}
