-- Optional sample catalogue rows. Mirrors src/lib/sample-styles.ts.
-- Run after 0001_init.sql. Photos point at deterministic placeholders;
-- swap photo_url for your Supabase Storage public URLs once you upload images.

insert into public.styles (name, photo_url, tags) values
  ('Soft Layered Lob', 'https://picsum.photos/seed/lob/600/800',      '{"length":"medium","color":"brunette","texture":"wavy","face_shape":"oval"}'),
  ('Blunt Bob',        'https://picsum.photos/seed/bob/600/800',      '{"length":"short","color":"black","texture":"straight","face_shape":"round"}'),
  ('Beach Waves',      'https://picsum.photos/seed/waves/600/800',    '{"length":"long","color":"honey blonde","texture":"wavy","face_shape":"heart"}'),
  ('Pixie Crop',       'https://picsum.photos/seed/pixie/600/800',    '{"length":"short","color":"platinum","texture":"straight","face_shape":"oval"}'),
  ('Curtain Bangs',    'https://picsum.photos/seed/curtain/600/800',  '{"length":"medium","color":"chestnut","texture":"straight","face_shape":"square"}'),
  ('Balayage Layers',  'https://picsum.photos/seed/balayage/600/800', '{"length":"long","color":"caramel","texture":"wavy","face_shape":"oval"}'),
  ('Tight Curls',      'https://picsum.photos/seed/curls/600/800',    '{"length":"medium","color":"black","texture":"coily","face_shape":"round"}'),
  ('Sleek Straight',   'https://picsum.photos/seed/sleek/600/800',    '{"length":"long","color":"jet black","texture":"straight","face_shape":"heart"}');
