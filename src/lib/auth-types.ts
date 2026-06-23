export type User = {
  id: number;
  email: string;
  nickname: string;
  is_adult: number;
  nsfw_on: number;
  points: number;
  sub_until: string | null;
  google_id: string | null;
  pref: string | null; // 'female' | 'male' | null(전체)
  sub_plan: string | null; // 'basic' | 'pro' | null
  sub_auto_renew: number;
  notice_last_read_id: number;
};

export function isSubscribed(user: User): boolean {
  return !!user.sub_until && new Date(user.sub_until) > new Date();
}
