import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Strategy } from 'passport-custom';
import { Repository } from 'typeorm';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export interface ProxyHeaderAuthContext {
  user: UserEntity;
  workspace: WorkspaceEntity;
  userWorkspace: UserWorkspaceEntity;
}

@Injectable()
export class ProxyHeaderAuthStrategy extends PassportStrategy(
  Strategy,
  'proxy-header',
) {
  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
  ) {
    super();
  }

  async validate(request: Request): Promise<ProxyHeaderAuthContext> {
    // Check if proxy header auth is enabled
    const isEnabled = this.twentyConfigService.get('AUTH_PROXY_HEADER_ENABLED');

    if (!isEnabled) {
      throw new AuthException(
        'Proxy header authentication is not enabled',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    // Extract headers (case-insensitive)
    const email =
      request.headers['x-authentik-email'] ||
      request.headers['x-user-email'] ||
      request.headers['x-forwarded-email'];

    const name =
      request.headers['x-authentik-name'] ||
      request.headers['x-user-name'] ||
      request.headers['x-forwarded-user'];

    const uid =
      request.headers['x-authentik-uid'] ||
      request.headers['x-user-id'] ||
      request.headers['x-forwarded-uid'];

    if (!email || typeof email !== 'string') {
      throw new AuthException(
        'Missing or invalid email header',
        AuthExceptionCode.INVALID_INPUT,
      );
    }

    // Find existing user by email
    let user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    // Get default workspace (first active one, or create based on config)
    const defaultWorkspaceId = this.twentyConfigService.get(
      'AUTH_PROXY_HEADER_DEFAULT_WORKSPACE_ID',
    );

    let workspace: WorkspaceEntity | null = null;

    if (defaultWorkspaceId) {
      workspace = await this.workspaceRepository.findOne({
        where: { id: defaultWorkspaceId },
      });
    }

    if (!workspace) {
      // Get first active workspace
      workspace = await this.workspaceRepository.findOne({
        where: { activationStatus: 'ACTIVE' as any },
        order: { createdAt: 'ASC' },
      });
    }

    if (!workspace) {
      throw new AuthException(
        'No workspace available',
        AuthExceptionCode.WORKSPACE_NOT_FOUND,
      );
    }

    // Auto-create user if doesn't exist
    if (!user) {
      const autoCreateEnabled = this.twentyConfigService.get(
        'AUTH_PROXY_HEADER_AUTO_CREATE_USER',
      );

      if (!autoCreateEnabled) {
        throw new AuthException(
          'User not found and auto-creation is disabled',
          AuthExceptionCode.USER_NOT_FOUND,
        );
      }

      // Parse name into first/last
      let firstName = '';
      let lastName = '';

      if (name && typeof name === 'string') {
        const nameParts = name.trim().split(' ');
        firstName = nameParts[0] || '';
        lastName = nameParts.slice(1).join(' ') || '';
      }

      user = this.userRepository.create({
        email: email.toLowerCase(),
        firstName,
        lastName,
        isEmailVerified: true, // Trust the proxy
        defaultAvatarUrl: '',
      });

      user = await this.userRepository.save(user);
    }

    // Find or create user-workspace association
    let userWorkspace = await this.userWorkspaceRepository.findOne({
      where: {
        userId: user.id,
        workspaceId: workspace.id,
      },
      relations: ['user', 'workspace'],
    });

    if (!userWorkspace) {
      userWorkspace = this.userWorkspaceRepository.create({
        userId: user.id,
        workspaceId: workspace.id,
        user,
        workspace,
      });
      userWorkspace = await this.userWorkspaceRepository.save(userWorkspace);
      userWorkspace.user = user;
      userWorkspace.workspace = workspace;
    }

    return {
      user,
      workspace,
      userWorkspace,
    };
  }
}
