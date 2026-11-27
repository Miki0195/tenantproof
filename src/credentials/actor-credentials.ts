import { inspect } from 'node:util';

export type AuthScheme = 'none' | 'bearer';

/** Token-free description of an actor's credentials, safe for logs and reports. */
export interface ActorAuthSummary {
  readonly actorId: string;
  readonly scheme: AuthScheme;
  readonly tokenEnv?: string;
}

/**
 * In-memory credentials for one actor. The token lives in a private field, so JSON,
 * `util.inspect`, string conversion, `structuredClone` and test snapshots never see it.
 */
export class ActorCredentials {
  readonly actorId: string;
  readonly scheme: AuthScheme;
  readonly tokenEnv: string | undefined;
  readonly #token: string | undefined;

  private constructor(
    actorId: string,
    tokenEnv: string | undefined,
    token: string | undefined,
  ) {
    this.actorId = actorId;
    this.scheme = token === undefined ? 'none' : 'bearer';
    this.tokenEnv = tokenEnv;
    this.#token = token;
  }

  static anonymous(actorId: string): ActorCredentials {
    return new ActorCredentials(actorId, undefined, undefined);
  }

  static bearer(
    actorId: string,
    tokenEnv: string,
    token: string,
  ): ActorCredentials {
    return new ActorCredentials(actorId, tokenEnv, token);
  }

  /** Request headers for this actor. Pass them to the HTTP client only; never store or log them. */
  headers(): Readonly<Record<string, string>> {
    return Object.freeze(
      this.#token === undefined
        ? {}
        : { Authorization: `Bearer ${this.#token}` },
    );
  }

  toJSON(): ActorAuthSummary {
    return this.tokenEnv === undefined
      ? { actorId: this.actorId, scheme: this.scheme }
      : { actorId: this.actorId, scheme: this.scheme, tokenEnv: this.tokenEnv };
  }

  toString(): string {
    return `ActorCredentials(${this.actorId}, ${this.scheme})`;
  }

  [inspect.custom](): string {
    return `ActorCredentials ${inspect(this.toJSON())}`;
  }
}
