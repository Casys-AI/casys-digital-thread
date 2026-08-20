/** Browser-safe reopen of one sealed architecture SysML document. */
export interface ThreadArchitectureSysmlSealLocation {
  line: number;
  column: number;
}

export interface ThreadArchitectureSysmlSealSpan {
  start: ThreadArchitectureSysmlSealLocation;
  end: ThreadArchitectureSysmlSealLocation;
}

export interface ThreadArchitectureSysmlSealSymbol {
  id: string;
  kind: string;
  label?: string;
  span?: ThreadArchitectureSysmlSealSpan;
}

export interface ThreadArchitectureSysmlSealUnresolved {
  id: string;
  kind: string;
  message?: string;
  span?: ThreadArchitectureSysmlSealSpan;
}

export interface ThreadArchitectureSysmlSealIncidence {
  id: string;
  kind: "structural-incidence";
  fromSymbolId: string;
  toSymbolId: string;
  span?: ThreadArchitectureSysmlSealSpan;
}

export interface ThreadArchitectureSysmlSealPresentation {
  producer: "model.seal-architecture-sysml@1";
  authority: "documentary";
  artifactKind: "document";
  notSyson: true;
  notWriteArchitecture: true;
  notCompilationAdmission: true;
  symbolsStatus: "observed" | "unavailable";
  sourceStatus: "observed" | "unavailable";
  sourceText?: string;
  symbols: ThreadArchitectureSysmlSealSymbol[];
  incidences: ThreadArchitectureSysmlSealIncidence[];
  unresolvedConstructs: ThreadArchitectureSysmlSealUnresolved[];
}
