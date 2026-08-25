
UPDATE public.extractions
   SET status = 'failed',
       error_message = 'AI could not extract any fields from this image',
       needs_review = false
 WHERE status = 'success'
   AND is_duplicate = false
   AND (customer_name IS NULL OR customer_name = '')
   AND (order_number  IS NULL OR order_number  = '')
   AND (phone_number  IS NULL OR phone_number  = '');

-- Recalculate batch counters for every batch based on the corrected rows.
UPDATE public.batches b
   SET processed_count = sub.processed,
       failed_count    = sub.failed,
       duplicate_count = sub.dups
  FROM (
    SELECT batch_id,
           COUNT(*) FILTER (WHERE status = 'success' AND is_duplicate = false) AS processed,
           COUNT(*) FILTER (WHERE status = 'failed')                            AS failed,
           COUNT(*) FILTER (WHERE is_duplicate = true)                          AS dups
      FROM public.extractions
     GROUP BY batch_id
  ) sub
 WHERE b.id = sub.batch_id;
