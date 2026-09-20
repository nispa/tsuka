import { CommandHandler } from './types';
import { controlSudo } from '../../core/sudoControl';
import { logSink } from '../../core/logSink';

export const handleSudo: CommandHandler = async (ctx, arg) => {
  logSink.log(controlSudo(ctx.permissionManager, arg));
};
