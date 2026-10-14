// Public rate/examples have separate operator approval; paid inventory stays gated.
import {validateSponsorOrder} from './sponsor-order.mjs';
import {renderPromo,renderRateCard} from './paid-promo.mjs';
export function renderSponsorInventory(inventory,{preview=false}={}) {
 if(inventory?.schema!=='glp327_sponsor_inventory_v1'||!Array.isArray(inventory.orders)) throw Error('Invalid sponsor inventory');
 const {selection,orders}=inventory;
 const resourceApproval=inventory.public_resources;
 const publishResources=resourceApproval?.status==='approved'
  && resourceApproval.decision==='OPERATOR-DECISION-20261014-grill-day-plan'
  && resourceApproval.scope==='rate-card-and-example-only';
 if(resourceApproval!==undefined&&!publishResources) throw Error('Exact public-resource approval required');
 const resourcePages=preview||publishResources?{'sponsors/rates/index.html':renderRateCard(),'sponsors/example-provider/index.html':renderPromo()}:{};
 if(selection===null) return {order:null,pages:resourcePages};
 if(preview) throw Error('Live order cannot be selected in example preview');
 if(selection?.slot!=='providers-directory-panel'||typeof selection.order_reference!=='string'||!selection.order_reference) throw Error('Exact sponsor inventory selection required');
 const matches=orders.filter(order=>order.order_reference===selection.order_reference);
 if(matches.length!==1||matches[0].inventory_slot!==selection.slot) throw Error('Missing, duplicate or mismatched sponsor order');
 const order=validateSponsorOrder(matches[0]);
 return {order,pages:{...resourcePages,[`sponsors/${order.slug}/index.html`]:renderPromo(order,{preview:false})}};
}
