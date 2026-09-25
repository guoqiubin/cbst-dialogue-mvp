-- Preserve existing accounts while allowing cloud progress for the emotion module.
alter table public.user_progress
  drop constraint if exists user_progress_module_check;

alter table public.user_progress
  add constraint user_progress_module_check
  check (module in ('dialogue', 'cognitive', 'logic-training', 'empathy', 'emotion'));
