-- A block names its training phase, so clients can show the shape of a plan and the coach
-- organises a schedule by purpose. Phases may repeat (two build blocks are Build 1 and Build 2).
-- Existing blocks, including locked ones, stay unclassified; this adds no content to them.
ALTER TABLE training_blocks ADD COLUMN phase text
 CONSTRAINT training_blocks_phase_check CHECK (phase IN ('base','build','peak','taper','recovery'));
