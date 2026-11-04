export interface UserProfileResponse {
  id: string;
  username: string;
  role: string;
  created_at: Date;
  updated_at: Date;
  profile: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone_number: string | null;
    created_at: Date;
    updated_at: Date;
  } | null;
}
