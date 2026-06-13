export type Message = {
  id?: string;
  text: string;
  userUid: string;
  displayName?: string | null;
  createdAt?: string | null;
};