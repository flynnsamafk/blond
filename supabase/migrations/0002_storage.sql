-- Storage buckets for catalogue images and customer uploads.

-- Public, read-only catalogue images (style photos).
insert into storage.buckets (id, name, public)
values ('catalogue', 'catalogue', true)
on conflict (id) do nothing;

-- Private customer selfies. Files are namespaced per user: <uid>/<filename>.
insert into storage.buckets (id, name, public)
values ('customer-uploads', 'customer-uploads', false)
on conflict (id) do nothing;

-- ---- catalogue bucket policies ------------------------------------------

drop policy if exists "Public read catalogue" on storage.objects;
create policy "Public read catalogue"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'catalogue');

drop policy if exists "Authenticated manage catalogue" on storage.objects;
create policy "Authenticated manage catalogue"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'catalogue')
  with check (bucket_id = 'catalogue');

-- ---- customer-uploads bucket policies -----------------------------------
-- Each user may only read/write files under a folder named after their uid.

drop policy if exists "Users read own uploads" on storage.objects;
create policy "Users read own uploads"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'customer-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users write own uploads" on storage.objects;
create policy "Users write own uploads"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'customer-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own uploads" on storage.objects;
create policy "Users delete own uploads"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'customer-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
