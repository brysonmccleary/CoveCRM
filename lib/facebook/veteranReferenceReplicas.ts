export type VeteranReferenceReplica = {
  replicaId: string;
  referenceTile: number;
  width: number;
  height: number;
  referenceCropPath: string;
  defaultAmount: "$40,000" | "$50,000" | "$8,000";
  imageUrl: string;
  imageOriented: boolean;
  masterSet: "REFERENCE_REPLICA";
  ownerApprovalStatus: "PENDING_REVIEW";
  deployed: false;
};

export const REFERENCE_REPLICA_SUPPORTED_COVERAGE_AMOUNTS = ["$40,000", "$50,000", "$100,000"] as const;

export function buildVeteranReferenceReplicas(): VeteranReferenceReplica[] {
  const dimensions = [
    [332,413],[331,413],[334,413],
    [332,388],[331,388],[334,388],
    [332,347],[331,347],[334,347],
    [332,350],[331,350],[334,350],
  ] as const;
  const defaultAmounts = ["$50,000","$40,000","$8,000","$50,000","$50,000","$50,000","$40,000","$50,000","$50,000","$50,000","$40,000","$50,000"] as const;
  return dimensions.map(([width,height],index)=>({
    replicaId:`VET_REPLICA_${String(index+1).padStart(2,"0")}`,
    referenceTile:index+1,
    width,
    height,
    referenceCropPath:`artifacts/veteran-reference-replicas/reference-crops/REFERENCE_${String(index+1).padStart(2,"0")}.png`,
    defaultAmount:defaultAmounts[index],
    imageUrl:index===6?"/ad-backgrounds/veteran/3.jpg":"",
    imageOriented:index===6,
    masterSet:"REFERENCE_REPLICA",
    ownerApprovalStatus:"PENDING_REVIEW",
    deployed:false,
  }));
}
