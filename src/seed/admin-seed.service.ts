import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { UserRole } from '../common/enums';

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private usersService: UsersService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    const email = this.config.get<string>('SYSTEM_ADMIN_EMAIL');
    const password = this.config.get<string>('SYSTEM_ADMIN_PASSWORD');

    if (!email || !password) {
      this.logger.warn('SYSTEM_ADMIN_EMAIL or SYSTEM_ADMIN_PASSWORD not set — skipping system admin seed');
      return;
    }

    try {
      const existing = await this.usersService.findByEmail(email);
      if (existing) {
        const existingRoles = this.usersService.resolveRoles(existing);
      if (!existingRoles.includes(UserRole.ADMIN)) {
          await this.usersService.setRole(existing._id.toHexString(), UserRole.ADMIN);
          this.logger.log(`System admin role enforced for ${email}`);
        }
        return;
      }

      const hash = await bcrypt.hash(password, 10);
      await this.usersService.create({
        username: 'systemadmin',
        email,
        password: hash,
        displayName: 'System Admin',
        roles: [UserRole.ADMIN],
        emailVerified: true,
      });
      this.logger.log(`System admin created: ${email}`);
    } catch (e) {
      this.logger.error('System admin seed failed', e instanceof Error ? e.stack : String(e));
    }
  }
}
