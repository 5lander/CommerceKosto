/**
 * Timeout de peticion — "timeouts en todo" (CLAUDE.md §5 y §13).
 *
 * ES LA SEGUNDA DE DOS DEFENSAS, NO LA UNICA. La primera es
 * `statement_timeout`, fijado en el propio rol `costeo_app`: corta la consulta
 * DENTRO de PostgreSQL y libera la conexion. Este interceptor corta la
 * PETICION, que es otra cosa: sin el, una peticion bloqueada en algo que no es
 * la base retiene un socket y un slot del limitador hasta que el cliente se
 * canse. Con suficientes de esas, la API deja de aceptar peticiones nuevas sin
 * que ningun recurso parezca agotado.
 */

import {
  CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { type Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

import { CONFIGURATION, type Configuration } from '../config/environment';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  public constructor(@Inject(CONFIGURATION) private readonly config: Configuration) {}

  public intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout({ each: this.config.requestTimeoutMs }),
      catchError((error: unknown) =>
        throwError(() => (error instanceof TimeoutError ? new RequestTimeoutException() : error)),
      ),
    );
  }
}
