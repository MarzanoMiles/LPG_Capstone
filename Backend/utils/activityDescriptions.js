const resources = {
  users:'user', roles:'role', branches:'branch', warehouses:'warehouse', suppliers:'supplier',
  customers:'customer', products:'product', brands:'brand', categories:'category',
  inventory:'inventory record', sales:'sale', payments:'payment', orders:'order',
  deliveries:'delivery', 'purchase-orders':'purchase order', restocking:'restock recommendation',
  reports:'report', data:'data', dashboard:'dashboard', settings:'settings', auth:'account',
};
const fields = {
  SupplierName:'name', ContactPerson:'contact person', Email:'email address', Address:'address',
  Contact:'contact number', ContactNo:'contact number', LeadTimeDays:'lead time', Status:'status',
  FirstName:'first name', LastName:'last name', RoleID:'role', ModuleAccess:'module access',
  BranchID:'branch assignment', WarehouseID:'warehouse assignment', PasswordHash:'password',
  ProductName:'name', Price:'price', UnitPrice:'price', Cost:'cost', UnitCost:'cost',
  ReorderLevel:'reorder level', StockOnHand:'stock quantity', WarehouseName:'name', Location:'location',
  BranchName:'name', RoleName:'name', Brand:'name', Category:'name', TypeName:'name',
  OrderStatus:'status', DeliveryStatus:'status', DeliveredByUserID:'assigned driver', Remarks:'notes',
  CustomerName:'name', CustomerType:'customer type', CompanyName:'company name',
};
function joinWords(values) {
  if(values.length<2)return values[0] || '';
  return values.slice(0,-1).join(', ')+' and '+values.at(-1);
}
function resourceFor(pathname) {
  const parts=String(pathname || '').split('?')[0].split('/').filter(Boolean);
  if(parts[0]==='user-settings')return resources[parts[1]] || 'setting';
  if(parts[0]==='suppliers' && parts[1]==='types')return 'supplier type';
  if(parts[1]==='activity-log' || (parts[0]==='data' && parts[1]==='logs'))return 'activity log';
  if(parts[0]==='settings')return ({operations:'business operations settings',profile:'company profile',logo:'company logo',tax:'tax settings',receipt:'receipt settings',system:'system settings'})[parts[1]] || 'settings';
  return resources[parts[0]] || 'record';
}
function describeAction(action, resource, changedFields=[]) {
  const labels=[...new Set(changedFields.map(key=>fields[key]).filter(Boolean))];
  if(action==='Update' && labels.length)return `Updated ${resource} ${joinWords(labels)}.`;
  const text={
    Create:`Created ${/^[aeiou]/i.test(resource)?'an':'a'} ${resource}.`,
    Update:`Updated ${resource} details.`, Delete:`Deleted ${/^[aeiou]/i.test(resource)?'an':'a'} ${resource}.`,
    View:`Viewed ${resource === 'activity log' ? 'the activity log' : resource+' details'}.`,
    Preview:`Previewed ${resource === 'purchase order'?'a purchase order document':resource+' details'}.`,
    Export:`Exported ${resource}.`, Import:`Imported ${resource} records.`,
    Approve:`Approved ${resource}.`, Reject:`Rejected ${resource}.`, Dispatch:'Dispatched a delivery.',
    Complete:'Completed a delivery.', 'Failed Attempt':'Recorded a failed delivery attempt.',
    Settle:`Settled ${resource}.`, Cancel:`Cancelled ${resource}.`, Receive:'Received a purchase order delivery.',
    Refund:'Recorded a refund.', Claim:'Completed a pickup claim.', Generate:`Generated ${resource}.`,
    Send:`Sent ${resource}.`, 'Send Payment':'Sent a purchase order payment confirmation.',
    Logout:'User signed out.', 'Stock In':'Recorded stock received.', 'Stock Out':'Recorded stock issued.',
    Transfer:'Transferred stock between warehouses.', Adjustment:'Adjusted inventory stock.',
    'Access Denied':`Attempted to access ${resource} management without permission.`,
  };
  return text[action] || `Performed an action on ${resource}.`;
}
function historicalDescription(description) {
  const match=String(description || '').match(/^(Denied )?(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s;?]*)/i);
  if(!match)return description;
  const action=match[1]?'Access Denied':({GET:'View',POST:'Create',PUT:'Update',PATCH:'Update',DELETE:'Delete'})[match[2].toUpperCase()];
  return describeAction(action,resourceFor(match[3]));
}
module.exports={resourceFor,describeAction,historicalDescription};
