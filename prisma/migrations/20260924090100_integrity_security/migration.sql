-- ════════════════════════════════════════════════════════════════════
-- Intégrité, concurrence et sécurité — garanties portées par PostgreSQL
-- (défense en profondeur : le code applicatif les respecte déjà, la base
-- les impose même en cas de bug ou d'accès direct).
-- ════════════════════════════════════════════════════════════════════

-- ─── Contraintes CHECK ───
ALTER TABLE product
  ADD CONSTRAINT product_price_nonneg CHECK ("priceCents" >= 0),
  ADD CONSTRAINT product_compare_gt_price CHECK ("compareAtCents" IS NULL OR "compareAtCents" > "priceCents"),
  ADD CONSTRAINT product_stock_nonneg CHECK ("stockOnHand" >= 0 AND "stockReserved" >= 0),
  ADD CONSTRAINT product_reserved_le_onhand CHECK ("stockReserved" <= "stockOnHand"),
  ADD CONSTRAINT product_deposit_range CHECK ("depositPercent" IS NULL OR "depositPercent" BETWEEN 1 AND 99);

ALTER TABLE tax_rate ADD CONSTRAINT tax_rate_range CHECK ("rateBps" BETWEEN 0 AND 10000);

ALTER TABLE "order"
  ADD CONSTRAINT order_amounts_nonneg CHECK ("totalCents" >= 0 AND "taxCents" >= 0 AND "totalExclTaxCents" >= 0 AND "amountPaidCents" >= 0 AND "amountRefundedCents" >= 0),
  ADD CONSTRAINT order_total_consistent CHECK ("totalExclTaxCents" + "taxCents" = "totalCents"),
  ADD CONSTRAINT order_refund_le_paid CHECK ("amountRefundedCents" <= "amountPaidCents"),
  ADD CONSTRAINT order_paid_le_total CHECK ("amountPaidCents" <= "totalCents");

ALTER TABLE order_item
  ADD CONSTRAINT order_item_qty_pos CHECK (quantity > 0),
  ADD CONSTRAINT order_item_total_consistent CHECK ("totalExclTaxCents" + "taxCents" = "totalCents");

ALTER TABLE cart_item ADD CONSTRAINT cart_item_qty_pos CHECK (quantity > 0);
ALTER TABLE stock_reservation ADD CONSTRAINT reservation_qty_pos CHECK (quantity > 0);
ALTER TABLE payment ADD CONSTRAINT payment_amount_pos CHECK ("amountCents" > 0);
ALTER TABLE refund ADD CONSTRAINT refund_amount_pos CHECK ("amountCents" > 0);
ALTER TABLE compliance_rule
  ADD CONSTRAINT rule_min_age CHECK ("minimumAge" IS NULL OR "minimumAge" BETWEEN 0 AND 120),
  ADD CONSTRAINT rule_legal_reference CHECK (basis <> 'LEGAL' OR "legalReference" IS NOT NULL),
  ADD CONSTRAINT rule_active_reviewed CHECK (status <> 'ACTIVE' OR ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)),
  ADD CONSTRAINT rule_effective_range CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");
ALTER TABLE coupon ADD CONSTRAINT coupon_usage CHECK ("usedCount" >= 0 AND ("maxUses" IS NULL OR "usedCount" <= "maxUses"));

-- ─── Unicités partielles (concurrence) ───
-- Un animal ne peut avoir qu'une seule réservation vivante : deux ventes simultanées
-- du même individu sont impossibles, même en cas de bug applicatif.
CREATE UNIQUE INDEX stock_reservation_one_live_per_animal
  ON stock_reservation ("animalId") WHERE "animalId" IS NOT NULL AND status IN ('ACTIVE', 'ALLOCATED');
-- Une seule version active par code de règle.
CREATE UNIQUE INDEX compliance_rule_one_active_version ON compliance_rule (code) WHERE status = 'ACTIVE';

-- ─── Journal d'audit en ajout seul ───
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % en ajout seul : % interdit', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER inventory_movement_append_only BEFORE UPDATE OR DELETE ON inventory_movement FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER compliance_evaluation_append_only BEFORE UPDATE OR DELETE ON compliance_evaluation FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- TRUNCATE contourne les triggers de ligne : on l'interdit aussi.
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER inventory_movement_no_truncate BEFORE TRUNCATE ON inventory_movement FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER compliance_evaluation_no_truncate BEFORE TRUNCATE ON compliance_evaluation FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ─── Factures émises immuables ───
CREATE OR REPLACE FUNCTION invoice_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une facture émise ne peut pas être supprimée (émettre un avoir)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.number, NEW.kind, NEW."orderId", NEW."issuedAt", NEW.seller, NEW.customer, NEW.lines, NEW."vatBreakdown",
      NEW."totalExclTaxCents", NEW."taxCents", NEW."totalCents", NEW.currency, NEW."paymentId", NEW."refundId", NEW."creditedInvoiceId")
     IS DISTINCT FROM
     (OLD.number, OLD.kind, OLD."orderId", OLD."issuedAt", OLD.seller, OLD.customer, OLD.lines, OLD."vatBreakdown",
      OLD."totalExclTaxCents", OLD."taxCents", OLD."totalCents", OLD.currency, OLD."paymentId", OLD."refundId", OLD."creditedInvoiceId") THEN
    RAISE EXCEPTION 'Une facture émise est immuable (émettre un avoir)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON invoice FOR EACH ROW EXECUTE FUNCTION invoice_immutable();
CREATE TRIGGER invoice_no_truncate BEFORE TRUNCATE ON invoice FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Une règle ACTIVE ou RETIRED n'est plus modifiable, hormis son retrait (ACTIVE → RETIRED).
CREATE OR REPLACE FUNCTION rule_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Une règle publiée ne peut pas être supprimée' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' THEN
    IF NOT (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED'
            AND (to_jsonb(NEW) - 'status' - 'effectiveUntil') = (to_jsonb(OLD) - 'status' - 'effectiveUntil')) THEN
      RAISE EXCEPTION 'Une règle publiée est immuable : créez une nouvelle version' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compliance_rule_immutable BEFORE UPDATE OR DELETE ON compliance_rule FOR EACH ROW EXECUTE FUNCTION rule_immutable();

-- ─── Row Level Security (données personnelles) ───
-- Requêtes « au nom du client » : withUserScope() fixe app.user_id pour la transaction.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['address', 'order', 'document', 'notification', 'wishlist_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_current_user_id() IS NULL OR "userId" = app_current_user_id()) '
      'WITH CHECK (app_current_user_id() IS NULL OR "userId" = app_current_user_id())',
      t || '_owner_isolation', t);
  END LOOP;
END $$;

-- ─── Index de recherche plein texte (catalogue) ───
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$;
CREATE INDEX product_name_trgm ON product USING gin (immutable_unaccent(lower(name)) gin_trgm_ops);
CREATE INDEX species_names_trgm ON species USING gin (immutable_unaccent(lower("commonName" || ' ' || "scientificName")) gin_trgm_ops);
