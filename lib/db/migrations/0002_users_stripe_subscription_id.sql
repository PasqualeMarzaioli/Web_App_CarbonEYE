-- Migration 0002: track the Stripe subscription that owns a user's plan.
--
-- Required by the upgrade flow: the user pays the prorated difference today
-- by swapping the existing Basic subscription to the Premium price via
-- stripe.subscriptions.update({ proration_behavior: 'always_invoice' }).
-- Without this column we cannot look the subscription up at upgrade time.
-- Author: Pasquale Marzaioli
ALTER TABLE users
  ADD COLUMN stripe_subscription_id varchar(64);

ALTER TABLE users
  ADD CONSTRAINT users_stripe_subscription_id_unique UNIQUE (stripe_subscription_id);
