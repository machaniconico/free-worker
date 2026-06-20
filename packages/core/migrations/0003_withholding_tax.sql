-- 0003_withholding_tax.sql
-- 源泉徴収税額の記録。報酬型取引の源泉徴収(10.21%/20.42%)を注文ごとに保持する。

ALTER TABLE orders ADD COLUMN withholding_tax INTEGER;
