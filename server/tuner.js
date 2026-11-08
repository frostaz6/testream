export function createTunerPool(maxTunerCount=1){
  const max=Math.min(32,Math.max(1,Math.floor(Number(maxTunerCount)||1)));
  const leases=new Map();
  return {
    max,
    get used(){return leases.size;},
    claim(owner,connection){
      if(!owner||!connection)throw new Error('Tuner lease needs an owner and connection');
      const previous=leases.get(owner);
      if(!previous&&leases.size>=max)return {granted:false,previous:null};
      leases.set(owner,connection);
      return {granted:true,previous:previous||null};
    },
    release(owner,connection){
      if(leases.get(owner)===connection){leases.delete(owner);return true;}
      return false;
    }
  };
}
