import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';

/**
 * Attaches `req.user` when a valid Bearer token is sent; otherwise continues without user.
 */
@Injectable()
export class OptionalJwtGqlGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    return GqlExecutionContext.create(context).getContext().req;
  }

  canActivate(context: ExecutionContext) {
    const req = this.getRequest(context);
    const auth = req.headers?.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) {
      req.user = undefined;
      return true;
    }
    return super.canActivate(context);
  }
}
