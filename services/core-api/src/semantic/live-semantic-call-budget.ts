/** A single shared bound across all Workers AI transports in one run. */
export class LiveSemanticCallBudget {
  private calls=0;
  private halted=false;
  constructor(readonly maximum: number, private readonly upstream: typeof fetch=fetch) {
    if(!Number.isSafeInteger(maximum) || maximum<1 || maximum>25) throw new Error('SEMANTIC_CALL_BUDGET_INVALID');
  }
  get available(): boolean { return !this.halted && this.calls<this.maximum; }
  get used(): number { return this.calls; }
  get providerHalted(): boolean { return this.halted; }
  readonly request: typeof fetch = async (...args) => {
    if(!this.available) throw new Error('SEMANTIC_CALL_BUDGET_EXHAUSTED');
    this.calls++;
    try {
      const response=await this.upstream(...args);
      if(response.status===401 || response.status===403 || response.status===429 || response.status>=500) this.halted=true;
      return response;
    } catch(error) { this.halted=true; throw error; }
  };
}
