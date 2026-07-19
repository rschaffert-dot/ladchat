-- Härda öl-mode-funktionerna (0004/0005) med samma search_path-mönster som 0002.

create or replace function public.beer_glass_capacity(size text)
returns integer language sql immutable set search_path = public as $$
  select case size
    when 'galopp' then 33
    when 'storstark' then 40
    when 'slaktarbagare' then 100
  end;
$$;

create or replace function public.beer_glass_points(size text)
returns integer language sql immutable set search_path = public as $$
  select case size
    when 'galopp' then 33
    when 'storstark' then 50
    when 'slaktarbagare' then 150
  end;
$$;

create or replace function public.beer_duration_bonus(minutes integer)
returns integer language sql immutable set search_path = public as $$
  select case minutes
    when 15 then 25
    when 30 then 12
    when 45 then 8
    when 60 then 5
    when 75 then 4
    when 90 then 3
    when 105 then 2
    when 120 then 1
    else 0
  end;
$$;
