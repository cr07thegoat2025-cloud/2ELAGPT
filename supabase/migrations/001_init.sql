create extension if not exists pgcrypto;
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);
create index if not exists conversations_user_updated on public.conversations(user_id, updated_at desc);
create index if not exists messages_conversation_created on public.messages(conversation_id, created_at);
create index if not exists usage_user_created on public.usage_events(user_id, created_at desc);
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.usage_events enable row level security;
create policy "Users manage own conversations" on public.conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage messages in own conversations" on public.messages for all using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())) with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy "Users read own usage" on public.usage_events for select using (auth.uid() = user_id);
create or replace function public.touch_conversation() returns trigger language plpgsql as $$
begin update public.conversations set updated_at = now() where id = new.conversation_id; return new; end; $$;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages for each row execute function public.touch_conversation();
