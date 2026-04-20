export interface GoogleClientSecrets {
  /** Parsed from the JSON file downloaded from Google Cloud Console. */
  installed?: GoogleClientInfo;
  web?: GoogleClientInfo;
}

export interface GoogleClientInfo {
  client_id: string;
  client_secret: string;
  auth_uri?: string;
  token_uri?: string;
  redirect_uris?: string[];
}

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
  scope: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
