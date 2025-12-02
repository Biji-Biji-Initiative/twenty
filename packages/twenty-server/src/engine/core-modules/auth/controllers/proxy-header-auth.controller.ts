import {
  Controller,
  Get,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Request, Response } from 'express';
import { Repository } from 'typeorm';

import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { ProxyHeaderAuthGuard } from 'src/engine/core-modules/auth/guards/proxy-header-auth.guard';
import { AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { ProxyHeaderAuthContext } from 'src/engine/core-modules/auth/strategies/proxy-header.auth.strategy';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

@Controller('auth')
@UseFilters(AuthRestApiExceptionFilter)
export class ProxyHeaderAuthController {
  constructor(
    private readonly loginTokenService: LoginTokenService,
    private readonly authService: AuthService,
    private readonly twentyConfigService: TwentyConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
  ) {}

  @Get('proxy-header/callback')
  @UseGuards(ProxyHeaderAuthGuard, PublicEndpointGuard, NoPermissionGuard)
  async proxyHeaderAuthCallback(
    @Req() req: Request & { user: ProxyHeaderAuthContext },
    @Res() res: Response,
  ) {
    const { user, workspace, userWorkspace } = req.user;

    // Generate login token
    const loginToken = await this.loginTokenService.generateLoginToken(
      user.email,
      workspace.id,
      AuthProviderEnum.SSO, // Treat proxy auth as SSO
    );

    // Redirect to verify endpoint with login token
    const redirectUri = this.authService.computeRedirectURI({
      loginToken: loginToken.token,
      workspace,
    });

    return res.redirect(redirectUri);
  }

  @Get('proxy-header/auto')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async proxyHeaderAutoLogin(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Check if proxy header auth is enabled
    const isEnabled = this.twentyConfigService.get('AUTH_PROXY_HEADER_ENABLED');

    if (!isEnabled) {
      // Redirect to normal login
      return res.redirect('/');
    }

    // Extract headers
    const email =
      req.headers['x-authentik-email'] ||
      req.headers['x-user-email'] ||
      req.headers['x-forwarded-email'];

    if (!email || typeof email !== 'string') {
      // No proxy headers, redirect to normal login
      return res.redirect('/');
    }

    const name =
      req.headers['x-authentik-name'] ||
      req.headers['x-user-name'] ||
      req.headers['x-forwarded-user'];

    // Find or create user
    let user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    // Get default workspace
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
      workspace = await this.workspaceRepository.findOne({
        where: { activationStatus: 'ACTIVE' as any },
        order: { createdAt: 'ASC' },
      });
    }

    if (!workspace) {
      return res.redirect('/?error=no_workspace');
    }

    // Auto-create user if doesn't exist
    if (!user) {
      const autoCreateEnabled = this.twentyConfigService.get(
        'AUTH_PROXY_HEADER_AUTO_CREATE_USER',
      );

      if (!autoCreateEnabled) {
        return res.redirect('/?error=user_not_found');
      }

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
        isEmailVerified: true,
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
    });

    if (!userWorkspace) {
      userWorkspace = this.userWorkspaceRepository.create({
        userId: user.id,
        workspaceId: workspace.id,
      });
      await this.userWorkspaceRepository.save(userWorkspace);
    }

    // Generate login token
    const loginToken = await this.loginTokenService.generateLoginToken(
      user.email,
      workspace.id,
      AuthProviderEnum.SSO,
    );

    // Redirect to verify endpoint
    const redirectUri = this.authService.computeRedirectURI({
      loginToken: loginToken.token,
      workspace,
    });

    return res.redirect(redirectUri);
  }
}
