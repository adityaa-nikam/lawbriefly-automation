-- Migration: 20261106000300_allow_null_last_alerted_at.sql
-- Description: Drops NOT NULL constraint on operational_alert_dedup.last_alerted_at to allow pending reservations (Task 20.2/Task 22 preflight).

alter table operational_alert_dedup alter column last_alerted_at drop not null;

