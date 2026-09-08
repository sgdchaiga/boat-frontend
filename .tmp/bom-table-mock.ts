export const useAuth = () => ({user:{organization_id:'demo'}});
const products = [
 {id:'nails-01',name:'2.5 special nails (25kg)',unit_of_measure:'bag',manufacturing_item_type:'finished_product',active:true},
 {id:'nails-02',name:'2.5 special nails (25kg)',unit_of_measure:'bag',manufacturing_item_type:'finished_product',active:true},
 {id:'nails-03',name:'Ceiling Nails Polished (25 Kg)',unit_of_measure:'bag',manufacturing_item_type:'finished_product',active:true},
 {id:'wire-01',name:'2.5 MM Drawn Wire Rod',unit_of_measure:'kg',manufacturing_item_type:'raw_material'},
];
let boms = [{id:'bom-01',product_id:'nails-01',product_name:products[0].name,version:'v1',status:'Draft',output_qty:1,output_unit:'bag',expected_scrap_qty:0.5,materials:[{item_id:'wire-01',item_name:'2.5 MM Drawn Wire Rod',qty:25,unit:'kg'}]}];
export const supabase = {from(table:string) { let payload:any; let target=''; return {
 select(){return this}, eq(column:string,value:string){if(column==='id')target=value;return this}, order(){return this},
 update(value:any){payload=value;return this},insert(value:any){payload=value;return this},
 single(){const saved={...payload,id:target||'bom-'+Math.random()};boms=[...boms.filter(b=>b.id!==saved.id),saved];return Promise.resolve({data:saved,error:null})},
 then(resolve:any){resolve({data:table==='products'?products:boms,error:null})},
};}};
