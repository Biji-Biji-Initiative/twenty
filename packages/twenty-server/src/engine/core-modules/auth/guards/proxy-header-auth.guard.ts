import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ProxyHeaderAuthGuard extends AuthGuard('proxy-header') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      return null; // Return null to allow fallback to other auth methods
    }
    return user;
  }
}
