// The registered build's exact selection path. Empty inventory is the shipped state.
import {validateSponsorOrder} from './sponsor-order.mjs';
import {renderPromo,renderRateCard} from './paid-promo.mjs';
export function renderSponsorInventory(inventory,{preview=false}={}) {
 if(inventory?.schema!=='glp327_sponsor_inventory_v1'||!Array.isArray(inventory.orders)) throw Error('Invalid sponsor inventory');
 const {selection,orders}=inventory;
 if(selection===null) return {order:null,pages:preview?{'sponsors/rates/index.html':renderRateCard(),'sponsors/example-provider/index.html':renderPromo()}: {}};
 if(preview) throw Error('Live order cannot be selected in example preview');
 if(selection?.slot!=='providers-directory-panel'||typeof selection.order_reference!=='string'||!selection.order_reference) throw Error('Exact sponsor inventory selection required');
 const matches=orders.filter(order=>order.order_reference===selection.order_reference);
 if(matches.length!==1||matches[0].inventory_slot!==selection.slot) throw Error('Missing, duplicate or mismatched sponsor order');
 const order=validateSponsorOrder(matches[0]);
 return {order,pages:{[`sponsors/${order.slug}/index.html`]:renderPromo(order,{preview:false})}};
}
