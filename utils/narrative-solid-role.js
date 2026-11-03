'use strict';
const ROLES = ['table', 'chair', 'bag', 'wall'];
function solidRole(node) {
  if (ROLES.includes(node.solidRole)) return node.solidRole;
  // Compatibility for previously authored, explicitly named furniture. Never
  // infer physical gravity for signals, annotations or arbitrary diagrams.
  const id = String(node.id || '').toLowerCase();
  if (/^(table|desk|mesa|bancada)(?:[-_]|\d|$)/.test(id)) return 'table';
  if (/^(chair|cadeira)(?:[-_]|\d|$)/.test(id)) return 'chair';
  if (/^(backpack|mochila|bag|bolsa)(?:[-_]|\d|$)/.test(id)) return 'bag';
  if (/^(wall|parede)(?:[-_]|\d|$)/.test(id)) return 'wall';
  return null;
}
module.exports = { ROLES, solidRole };
