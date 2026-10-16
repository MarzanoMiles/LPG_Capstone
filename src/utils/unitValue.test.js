import test from 'node:test';
import assert from 'node:assert/strict';
import {formatUnitValue, numericUnitValue} from './unitValue.js';
import {getItemChoices, updateItemSelection} from './inventoryItemSelection.js';

test('formats numeric and legacy measurements without NaN or repeated units', () => {
  for (const value of ['11', 11, '11 kg', ' 11 KG ']) assert.equal(formatUnitValue(value,'kg'),'11 kg');
  assert.equal(formatUnitValue('2.7 kg','kg'),'2.7 kg');
  assert.equal(formatUnitValue(0,'kg'),'0 kg');
  for (const value of [null, undefined, '', 'bad', '11 m', '-11 kg']) assert.equal(formatUnitValue(value,'kg'),'');
  assert.equal(numericUnitValue('1e3','kg'),null);
});
test('inventory choices match numeric and legacy unit values', () => {
  const products = [{category:'Cylinder',brand:'Brand',unit:'kg',unitValue:'11 kg',productId:'P-1'}];
  const choices = getItemChoices(products,{category:'Cylinder',brand:'Brand',weight:'11 kg'});
  assert.deepEqual(choices.weights,['11 kg']);
  assert.equal(choices.matches[0].productId,'P-1');
});

test('11 kg cylinder variants can be selected independently and reset on identity changes', () => {
  const products = [
    {category:'Cylinder',brand:'Brand',unit:'kg',unitValue:'11',productId:'regular',name:'Cylinder 11 kg'},
    {category:'Cylinder',brand:'Brand',unit:'kg',unitValue:'11',productId:'elite',name:'Cylinder 11 kg Elite'},
    {category:'Cylinder',brand:'Brand',unit:'kg',unitValue:'22',productId:'large',name:'Cylinder 22 kg'},
  ];
  const item = {category:'Cylinder',brand:'Brand',weight:'11 kg',productId:'',quantity:'2'};
  assert.equal(getItemChoices(products,item).matches.length,2);
  for (const id of ['regular','elite']) {
    const selected = updateItemSelection(products,item,'productId',id);
    assert.equal(selected.productId,id);
    assert.equal(selected.quantity,'');
    assert.equal(updateItemSelection(products,selected,'brand','Other').productId,'');
    assert.equal(updateItemSelection(products,selected,'weight','22 kg').productId,'large');
  }
  assert.equal(updateItemSelection(products,item,'productId','large').productId,'');
});
