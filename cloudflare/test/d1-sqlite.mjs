import {DatabaseSync} from 'node:sqlite';
export function sqliteD1(schema) {
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
 const result=(sql,args)=>{
  const statement=sqlite.prepare(sql);
  if(statement.columns().length)return {success:true,results:statement.all(...args),meta:{changes:0}};
  return {success:true,results:[],meta:{changes:Number(statement.run(...args).changes)}};
 };
 return {
  sqlite,
  prepare(sql){
   return {bind(...args){
    return {sql,args,async first(){return result(sql,args).results[0]??null;},async all(){return result(sql,args);},async run(){return result(sql,args);}};
   }};
  },
  async batch(statements){
   sqlite.exec('BEGIN');
   try{const values=statements.map(s=>result(s.sql,s.args));sqlite.exec('COMMIT');return values;}
   catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
 };
}
