declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    VITRINE_MASTER_EMAIL?: string;
    VITRINE_MASTER_LOGIN_EMAIL?: string;
    VITRINE_MASTER_PASSWORD_VERIFIER?: string;
    VITRINE_MASTER_SESSION_KEY?: string;
  }
}
