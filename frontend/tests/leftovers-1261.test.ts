// 1.26.1 — the small things found while building 1.26.0: a head never repeats the room (the C700: «Камера · Компьютерная» over «Компьютерная ·
// Камера (C700)»), and a message never lies over the control just pressed. The layout ones (time fields, consumables, sheet titles) are in qa-vacuum
// and qa-cards; the toast's place on a real page is in qa-setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roomBeside } from '../src/ui/format.ts';
import { rectsMeet } from '../src/ui/shell-logic.ts';

test('roomBeside: the room is said once — not when the name ends with it, not when it starts with it', () => {
  assert.equal(roomBeside('Компьютерная · Камера (C700)', 'Компьютерная'), '', 'the C700: its name starts with the room');
  assert.equal(roomBeside('Камера · Компьютерная', 'Компьютерная'), '', 'a name that ends with the room (as before)');
  assert.equal(roomBeside('компьютерная камера', 'Компьютерная'), '', 'any case, a space after the room');
  assert.equal(roomBeside('Камера у входа', 'Прихожая'), 'Прихожая', 'a name without the room keeps it beside');
  assert.equal(roomBeside('Зальная лампа', 'Зал'), 'Зал', 'at the start only a whole word: «Зальная» is not the room «Зал»');
  assert.equal(roomBeside('Свет', ''), '', 'no room, nothing to say');
  assert.equal(roomBeside('Свет', undefined), '');
  assert.equal(roomBeside('  Кухня  ', ' Кухня '), '', 'the name is the room itself');
});

test('rectsMeet: the toast over a button is a meeting; side by side or one above the other is not', () => {
  const toast = { top: 600, bottom: 650, left: 20, right: 340 };
  assert.equal(rectsMeet(toast, { top: 620, bottom: 664, left: 100, right: 260 }), true, '«Добавить кнопку» under the message');
  assert.equal(rectsMeet(toast, { top: 540, bottom: 584, left: 100, right: 260 }), false, 'a button above the message');
  assert.equal(rectsMeet(toast, { top: 650, bottom: 694, left: 100, right: 260 }), false, 'touching edges are not covering');
  assert.equal(rectsMeet(toast, { top: 610, bottom: 640, left: 340, right: 380 }), false, 'beside it');
});
