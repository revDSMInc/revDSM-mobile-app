/**
 * English → Spanish strings.
 *
 * **Spanish is an installer-only feature.** The sales side always renders English — see
 * `canSwitchLanguage` in `LanguageProvider`, which resolves the language rather than just
 * hiding the toggle.
 *
 * Keys are dotted paths that name WHERE a string appears, not what it says
 * (`installer.tab.all`, not `all`), so a word that needs two different translations in
 * two places can have them. English is the source of truth: `en` is a plain object, `es`
 * is typed against it, so a missing Spanish key is a compile error rather than a blank
 * label at runtime — and `t()` falls back to English if one ever slips through.
 *
 * ## Adding a screen
 *
 * 1. Add its keys under a new top-level group in `en`.
 * 2. Add the same keys to `es` — TypeScript will tell you if you miss one.
 * 3. In the screen: `const { t } = useTranslation()` then `t('group.key')`.
 *
 * Placeholders use `{name}` and are filled by the second argument of `t()`:
 * `t('installer.jobs.count', { count: 4 })`.
 */

export const en = {
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    yes: 'Yes',
    no: 'No',
    save: 'Save',
    done: 'Done',
    back: 'Back',
    retry: 'Try Again',
    loading: 'Loading…',
    close: 'Close',
    remove: 'Remove',
    start: 'Start',
  },

  account: {
    settings: 'Account Settings',
    jobTracker: 'Job Tracker',
    myLearning: 'My Learning',
    logout: 'Logout',
    /**
     * The language row — installers only (`canSwitchLanguage`). Always shown in the
     * language it switches TO.
     */
    switchToSpanish: 'Español',
    switchToEnglish: 'English',
    languageLabel: 'Language',
  },

  installer: {
    title: 'My Installs',
    jobsOne: 'Job',
    jobsMany: 'Jobs',
    /**
     * Tab labels. They do NOT match the `?period=` values behind them — the request
     * carries `all` / `tomorrow`, the installer reads Today / Tomorrow.
     */
    tabAll: 'Today',
    tabUpcoming: 'Tomorrow',
    emptyAll: 'No installs scheduled for today.',
    emptyUpcoming: 'No installs scheduled for tomorrow.',
    emptyError: "Couldn't load your installs. Pull down to retry.",

    leadId: 'Lead ID',
    customer: 'Customer',
    addressPending: 'Address Pending',
    resulted: 'RESULTED',

    startAppointment: 'Start Appointment',
    resumeAppointment: 'Resume Appointment',
    reviewAppointment: 'Review Appointment',
    /** A resulted job — the visit is over, so the button reports state, not an action. */
    completedAppointment: 'Completed Appointment',
    previewAppointment: 'Preview Appointment',
    appointmentExpired: 'Appointment Expired',
    startingJob: 'Starting Job…',

    notYetTitle: 'Not scheduled yet',
    notYetBody: "This job is scheduled for {date}. You can open it on the day.",
    notYetBodyNoDate: 'This job is scheduled for a later date. You can open it on the day.',

    /** Right day, too early — the arrival window hasn't opened yet. */
    tooEarlyTitle: 'Not open yet',
    tooEarlyBody: 'This job opens at {time}, when its arrival window starts.',

    leadCenter: 'Lead Center',
    timeline: 'Install Timeline',
    stepsDone: '{done} of {total} done',
    /** Per-step badges on the rail. Uppercase on purpose — they are chips, not prose. */
    badgeStart: 'START',
    badgeResume: 'RESUME',
    badgeDone: 'DONE',
    jobCompleted: 'Job Completed',
    msgOps: 'Msg Ops/IM',

    stepPickup: 'Pickup',
    stepPec: 'Pre-Existing Conditions',
    stepPre: 'Pre-Install Photos',
    stepMeasure: 'Verify Job Scope',
    stepPost: 'Post-Install Photos',
    stepCoc: 'CoC',
    stepReturn: 'Return',

    stepPickupDesc: 'Photo the material loaded for this job',
    stepPecDesc: 'Flag & photo site conditions before work',
    stepPreDesc: "Ghost-match the rep's shots",
    stepMeasureDesc: 'Confirm sold products, footage & colors',
    stepPostDesc: 'Second ghost pass — finished work',
    stepCocDesc: 'Scan the signed Certificate of Completion',
    stepReturnDesc: 'Photo unused material coming back',

    resultCantDoWork: "Can't Do Work",
    resultReset: 'Reset',
    resultNotHit: 'Not Hit',

    // ── Step 1 / 7 · Material pickup & return ────────────────────────────────
    materialPickup: 'Material Pickup',
    materialReturn: 'Material Return',
    materialPickupSub: 'Photo the material loaded for this job',
    materialReturnSub: 'Photo the material coming back to the warehouse',
    materialHint: 'Inventory Center matches your photos against what was issued.',
    materialSkipPickup: 'Had Material On Truck — Nothing Picked Up',
    materialSkipReturn: 'Used All Material — Nothing to Return',
    materialSkippedPickup: 'Marked: had material on truck',
    materialSkippedReturn: 'Marked: used all material',
    materialSatisfiedPickup: 'Pickup satisfied — Inventory Center will reconcile',
    materialSatisfiedReturn: 'Return satisfied — Inventory Center will reconcile',
    takePhoto: 'Take Photo',
    takeAnotherPhoto: 'Take Another Photo',
    or: 'OR',
    cameraPickupLabel: 'PICKUP • Loaded Material',
    cameraReturnLabel: 'RETURN • Unused Material',
    cameraReturnHint: 'Photo the material coming back',
    // ── Step 2 · Pre-existing conditions ────────────────────────────────────
    pecTitle: 'Pre-Existing Conditions',
    pecSub: 'Document site conditions before starting work',
    pecIntro:
      'Review the work site before starting. Documented conditions protect you and the company from liability for damage that existed before the crew arrived.',
    pecNone: 'No Conditions Found',
    pecPresent: 'Conditions Present',
    pecNoneConfirmed: 'Site reviewed — no pre-existing conditions to report.',
    pecFlagAreas: 'Flag affected areas — each needs a photo and a note',
    pecAddPhoto: 'Add Photo',
    pecPhotosAdd: '{count} photo · add',
    pecPhotosAddPlural: '{count} photos · add',
    pecNotePlaceholder: 'Describe the condition — e.g. crack near garage, ~3 ft',
    pecSummaryOne: '{areas} area flagged · {photos} photos',
    pecSummaryMany: '{areas} areas flagged · {photos} photos',
    pecConfirm: 'Confirm Pre-Existing Conditions',
    pecIncomplete: 'Every flagged area needs at least one photo and a note',
    pecCameraHint: 'Photo the pre-existing damage or condition',
    pecDeleteBody:
      "This {area} photo will be removed from the job and deleted from the server. Every flagged area needs at least one photo, so you'll have to retake it before this step can close.",

    areaFront: 'Front Exterior',
    areaLeft: 'Left Side',
    areaRight: 'Right Side',
    areaBack: 'Back Exterior',
    areaRoof: 'Roof',
    areaSiding: 'Siding / Paint',
    areaDrive: 'Driveway / Walkways',
    areaYard: 'Landscaping / Yard',
    areaOther: 'Other',

    // ── Step 6 · Certificate of Completion ──────────────────────────────────
    cocTitle: 'Certificate of Completion',
    cocSub: 'Scan the CoC signed by the homeowner',
    cocIntro:
      'Capture every signed page. Fit the document inside the frame — edges are detected automatically.',
    cocDoneOne: 'Done — {count} Page Scanned',
    cocDoneMany: 'Done — {count} Pages Scanned',
    cocPage: 'Page {number}',
    cocDeleteTitle: 'Delete this page?',
    cocDeleteBody:
      "Page {number} of the signed CoC will be removed from this job and deleted from the server. You'll have to rescan it — the homeowner's signature can't be recovered from the app.",

    // ── Step 6 · CoC signed on the device (design port of the sales consent form) ──
    cocSignOnDevice: 'Sign Certificate of Completion',
    cocSignAgain: 'Edit Signed Certificate',
    cocSignedBy: 'Signed by {name} · {date}',
    cocSignatureOfInstaller: 'Installer',
    cocSignatureOfCustomer: 'Customer',
    cocSignedLocalNote: 'Signatures and certificate details sent to the office.',
    cocDoneSigned: 'Done — Certificate Signed',
    cocFormTitle: 'Certificate of Completion',
    cocPaperFallback: 'Paper Fallback',
    cocFormDisclaimerTitle: 'Certificate of Completion — Install',
    cocFormDisclaimerBody:
      'Please take a few minutes to review the completed work with the installer.',
    cocAttestAdult: 'I am 18 years or older.',
    cocAttestAuthorized:
      'I am the homeowner or I am authorized by the homeowner to sign this certificate.',
    cocAttestCompleted: 'The installation has been completed as per the contract.',
    cocFieldJobNumber: 'Job #*',
    cocFieldDate: 'Date*',
    cocInstallerSignature: "Installer's Signature *",
    cocCustomerSignature: "Customer's Signature *",
    cocRelationshipLabel: 'Relationship to homeowner',
    cocRelationshipHomeowner: 'Homeowner',
    cocRelationshipOther: 'Other',
    cocSignatureDraw: 'Draw Your Signature',
    cocSignatureHint: 'Use your finger or stylus to sign below.',
    cocSignatureClear: 'Clear',
    cocSignatureSave: 'Save Signature',
    cocSubmit: 'Submit',
    cocSubmitting: 'Submitting…',
    cocExitTitle: 'Exit certificate form?',
    cocExitBody:
      "You'll leave without capturing the certificate. Any info on this form won't be kept.",
    cocExitStay: 'Stay on Form',
    cocExitLeave: 'Exit Form',

    // ── Steps 3 / 5 · Photo match (pre & post install) ──────────────────────
    phasePre: 'PRE-INSTALL',
    phasePost: 'POST-INSTALL',
    matchedCount: '{done}/{total} MATCHED',
    /** Free-form phase (no rep capture set) — a count, never a fraction. */
    shotsTakenCount: '{done} TAKEN',
    repPhoto: 'REP PHOTO',
    preInstallPhoto: 'PRE-INSTALL PHOTO',
    matchedTapReview: '✓ MATCHED — tap to review',
    noRepPhoto: 'NO REP PHOTO FOR THIS TAG — TAP TO SHOOT',
    /** Eyebrow on a tag the rep never covered — it is an addition, not a match. */
    addPhoto: 'ADD PHOTO',
    loadingRepPhoto: 'LOADING REP PHOTO…',
    tapToMatch: 'TAP PHOTO TO MATCH WITH GHOST',
    selectTagRep: 'SELECT TAG TO VIEW REP PHOTO',
    /** Pre pass — the rep's tags are the floor, any other tag can be added to. */
    selectTagRepPlus: 'PICK A REP TAG — OR ANY OTHER TAG TO ADD A SHOT',
    selectTagPre: 'SELECT TAG TO VIEW PRE-INSTALL PHOTO',
    /** Free-form phase — says outright that the count is the installer's call. */
    selectTagFree: 'PICK A TAG AND SHOOT — TAKE AS MANY AS YOU NEED',
    allShotsMatched: 'Done — All Shots Matched',
    donePhotosTaken: 'Done — {count} Taken',
    /**
     * Floating hint over the tag picker. The Done button is the LAST thing in the
     * scroll, so on a short picker it sits below the fold with nothing to say it
     * exists — this points at it (and scrolls to it when tapped).
     */
    scrollForDone: 'Scroll down for Done',
    /** Same pill before the step is finishable — there is no Done to point at yet. */
    scrollForMore: 'More tags below',
    repSale: 'REP (SALE)',
    tagMatched: '{tag} — Matched',
    extraShotHint: "Free shot — no ghost. Document anything the rep didn't.",
    looksGood: 'Looks Good',

    // ── Step 4 · Verify job scope ───────────────────────────────────────────
    scopeTitle: 'Verify Job Scope',
    scopeSub: 'Sold products, footages & colors — confirm or flag',
    scopePendingOne: "{count} discrepancy awaiting IM — scope review can't close until resolved",
    scopePendingMany: "{count} discrepancies awaiting IM — scope review can't close until resolved",
    scopeAcknowledge: 'Acknowledge — No Scope on File',
    scopeDone: 'Done — Scope Reviewed',
    scopeNoProducts: 'No sold products on this job',
    scopeNoProductsBody:
      'Nothing was attached for you to verify — the job packet has no measurements, colors or product list on it.',
    scopeNoProductsAction:
      'Message your Install Manager before starting work. If you go ahead, there is no sold scope on record to check the finished job against. Acknowledge below to continue the install.',
    scopeConfirmCorrect: 'Confirm Correct',
    scopeDiscrepancy: 'Discrepancy',
    scopeConfirmed: 'Confirmed correct',
    scopeUndo: 'undo',
    scopePending: 'PENDING',
    scopeAwaitingIm: '{issue} — awaiting IM resolution',
    scopePhotoCountOne: ' • {count} photo',
    scopePhotoCountMany: ' • {count} photos',
    scopeResolvedBy: 'Resolved by IM — {issue}',
    scopeSummary: '{confirmed} confirmed · {resolved} resolved by IM',
    scopeDiscrepancySent: 'Discrepancy sent',
    scopeDiscrepancySentBody: 'The IM and rep have been notified.',

    retake: 'Retake',
    usePhoto: 'Use Photo',
    ghost: 'Ghost',
    deletePhotoTitle: 'Delete this photo?',
    deletePhotoBody:
      "Photo #{number} will be removed from this job and deleted from the server. You'll have to retake it.",
    delete: 'Delete',
    keep: 'Keep',

    jobPacket: 'Job Packet',
    contractDetails: 'Contract Details*',
    products: 'Products',
    view: 'View',
    pages: '{count} pages',
    contract: 'CONTRACT',
    downPayment: 'DOWN PAYMENT',
    remainingBalance: 'REMAINING BALANCE',
    loanAuth: 'LOAN AUTH',
  },
} as const;

/** Every key in `en`, so a gap in a translation is caught at compile time. */
export type TranslationTree = {
  [Group in keyof typeof en]: { [Key in keyof (typeof en)[Group]]: string };
};

export const es: TranslationTree = {
  common: {
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    yes: 'Sí',
    no: 'No',
    save: 'Guardar',
    done: 'Listo',
    back: 'Atrás',
    retry: 'Reintentar',
    loading: 'Cargando…',
    close: 'Cerrar',
    remove: 'Quitar',
    start: 'Comenzar',
  },

  account: {
    settings: 'Ajustes de cuenta',
    jobTracker: 'Seguimiento de trabajos',
    myLearning: 'Mi formación',
    logout: 'Cerrar sesión',
    switchToSpanish: 'Español',
    switchToEnglish: 'English',
    languageLabel: 'Idioma',
  },

  installer: {
    title: 'Mis instalaciones',
    jobsOne: 'Trabajo',
    jobsMany: 'Trabajos',
    tabAll: 'Hoy',
    tabUpcoming: 'Mañana',
    emptyAll: 'No hay instalaciones programadas para hoy.',
    emptyUpcoming: 'No hay instalaciones programadas para mañana.',
    emptyError: 'No se pudieron cargar tus instalaciones. Desliza para reintentar.',

    leadId: 'ID de cliente potencial',
    customer: 'Cliente',
    addressPending: 'Dirección pendiente',
    resulted: 'RESUELTO',

    startAppointment: 'Iniciar cita',
    resumeAppointment: 'Reanudar cita',
    reviewAppointment: 'Revisar cita',
    completedAppointment: 'Cita completada',
    previewAppointment: 'Vista previa de la cita',
    appointmentExpired: 'Cita vencida',
    startingJob: 'Iniciando trabajo…',

    notYetTitle: 'Aún no programado',
    notYetBody: 'Este trabajo está programado para el {date}. Podrás abrirlo ese día.',
    notYetBodyNoDate:
      'Este trabajo está programado para una fecha posterior. Podrás abrirlo ese día.',

    tooEarlyTitle: 'Aún no disponible',
    tooEarlyBody: 'Este trabajo se abre a las {time}, cuando comienza su ventana de llegada.',

    leadCenter: 'Centro de clientes',
    timeline: 'Cronograma de instalación',
    stepsDone: '{done} de {total} completados',
    badgeStart: 'INICIAR',
    badgeResume: 'CONTINUAR',
    badgeDone: 'LISTO',
    jobCompleted: 'Trabajo completado',
    msgOps: 'Mensaje a Operaciones/IM',

    stepPickup: 'Recogida',
    stepPec: 'Condiciones preexistentes',
    stepPre: 'Fotos previas a la instalación',
    stepMeasure: 'Verificar alcance del trabajo',
    stepPost: 'Fotos posteriores a la instalación',
    stepCoc: 'Certificado',
    stepReturn: 'Devolución',

    stepPickupDesc: 'Fotografía el material cargado para este trabajo',
    stepPecDesc: 'Marca y fotografía las condiciones del sitio antes de trabajar',
    stepPreDesc: 'Replica las fotos del representante',
    stepMeasureDesc: 'Confirma productos vendidos, medidas y colores',
    stepPostDesc: 'Segunda pasada — trabajo terminado',
    stepCocDesc: 'Escanea el Certificado de Finalización firmado',
    stepReturnDesc: 'Fotografía el material sin usar que regresa',

    resultCantDoWork: 'No se puede trabajar',
    resultReset: 'Restablecer',
    resultNotHit: 'No realizado',

    materialPickup: 'Recogida de material',
    materialReturn: 'Devolución de material',
    materialPickupSub: 'Fotografía el material cargado para este trabajo',
    materialReturnSub: 'Fotografía el material que regresa al almacén',
    materialHint: 'Inventario compara tus fotos con lo que se entregó.',
    materialSkipPickup: 'Tenía material en el camión — No se recogió nada',
    materialSkipReturn: 'Se usó todo el material — Nada que devolver',
    materialSkippedPickup: 'Marcado: tenía material en el camión',
    materialSkippedReturn: 'Marcado: se usó todo el material',
    materialSatisfiedPickup: 'Recogida completa — Inventario lo conciliará',
    materialSatisfiedReturn: 'Devolución completa — Inventario lo conciliará',
    takePhoto: 'Tomar foto',
    takeAnotherPhoto: 'Tomar otra foto',
    or: 'O',
    cameraPickupLabel: 'RECOGIDA • Material cargado',
    cameraReturnLabel: 'DEVOLUCIÓN • Material sin usar',
    cameraReturnHint: 'Fotografía el material que regresa',
    pecTitle: 'Condiciones preexistentes',
    pecSub: 'Documenta las condiciones del sitio antes de comenzar',
    pecIntro:
      'Revisa el sitio de trabajo antes de comenzar. Las condiciones documentadas te protegen a ti y a la empresa de responsabilidad por daños que ya existían antes de que llegara el equipo.',
    pecNone: 'No se encontraron condiciones',
    pecPresent: 'Hay condiciones',
    pecNoneConfirmed: 'Sitio revisado — no hay condiciones preexistentes que reportar.',
    pecFlagAreas: 'Marca las áreas afectadas — cada una necesita una foto y una nota',
    pecAddPhoto: 'Agregar foto',
    pecPhotosAdd: '{count} foto · agregar',
    pecPhotosAddPlural: '{count} fotos · agregar',
    pecNotePlaceholder: 'Describe la condición — p. ej. grieta cerca del garaje, ~1 m',
    pecSummaryOne: '{areas} área marcada · {photos} fotos',
    pecSummaryMany: '{areas} áreas marcadas · {photos} fotos',
    pecConfirm: 'Confirmar condiciones preexistentes',
    pecIncomplete: 'Cada área marcada necesita al menos una foto y una nota',
    pecCameraHint: 'Fotografía el daño o la condición preexistente',
    pecDeleteBody:
      'Esta foto de {area} se quitará del trabajo y se eliminará del servidor. Cada área marcada necesita al menos una foto, así que tendrás que tomarla de nuevo antes de cerrar este paso.',

    areaFront: 'Exterior frontal',
    areaLeft: 'Lado izquierdo',
    areaRight: 'Lado derecho',
    areaBack: 'Exterior trasero',
    areaRoof: 'Techo',
    areaSiding: 'Revestimiento / Pintura',
    areaDrive: 'Entrada / Aceras',
    areaYard: 'Jardín / Patio',
    areaOther: 'Otro',

    cocTitle: 'Certificado de finalización',
    cocSub: 'Escanea el certificado firmado por el propietario',
    cocIntro:
      'Captura todas las páginas firmadas. Encaja el documento dentro del marco — los bordes se detectan automáticamente.',
    cocDoneOne: 'Listo — {count} página escaneada',
    cocDoneMany: 'Listo — {count} páginas escaneadas',
    cocPage: 'Página {number}',
    cocDeleteTitle: '¿Eliminar esta página?',
    cocDeleteBody:
      'La página {number} del certificado firmado se quitará de este trabajo y se eliminará del servidor. Tendrás que escanearla de nuevo — la firma del propietario no se puede recuperar desde la app.',

    cocSignOnDevice: 'Firmar certificado de finalización',
    cocSignAgain: 'Editar certificado firmado',
    cocSignedBy: 'Firmado por {name} · {date}',
    cocSignatureOfInstaller: 'Instalador',
    cocSignatureOfCustomer: 'Cliente',
    cocSignedLocalNote: 'Firmas y datos del certificado enviados a la oficina.',
    cocDoneSigned: 'Listo — certificado firmado',
    cocFormTitle: 'Certificado de finalización',
    cocPaperFallback: 'Formulario en papel',
    cocFormDisclaimerTitle: 'Certificado de finalización — Instalación',
    cocFormDisclaimerBody:
      'Tómate unos minutos para revisar el trabajo terminado junto con el instalador.',
    cocAttestAdult: 'Tengo 18 años o más.',
    cocAttestAuthorized:
      'Soy el propietario o estoy autorizado por el propietario para firmar este certificado.',
    cocAttestCompleted: 'La instalación se completó según el contrato.',
    cocFieldJobNumber: 'N.º de trabajo*',
    cocFieldDate: 'Fecha*',
    cocInstallerSignature: 'Firma del instalador *',
    cocCustomerSignature: 'Firma del cliente *',
    cocRelationshipLabel: 'Relación con el propietario',
    cocRelationshipHomeowner: 'Propietario',
    cocRelationshipOther: 'Otro',
    cocSignatureDraw: 'Dibuja tu firma',
    cocSignatureHint: 'Usa tu dedo o lápiz para firmar abajo.',
    cocSignatureClear: 'Borrar',
    cocSignatureSave: 'Guardar firma',
    cocSubmit: 'Enviar',
    cocSubmitting: 'Enviando…',
    cocExitTitle: '¿Salir del formulario?',
    cocExitBody:
      'Saldrás sin capturar el certificado. La información de este formulario no se guardará.',
    cocExitStay: 'Seguir en el formulario',
    cocExitLeave: 'Salir del formulario',

    phasePre: 'PREINSTALACIÓN',
    phasePost: 'POSINSTALACIÓN',
    matchedCount: '{done}/{total} COINCIDEN',
    shotsTakenCount: '{done} TOMADAS',
    repPhoto: 'FOTO DEL REPRESENTANTE',
    preInstallPhoto: 'FOTO DE PREINSTALACIÓN',
    matchedTapReview: '✓ COINCIDE — toca para revisar',
    noRepPhoto: 'NO HAY FOTO PARA ESTA ETIQUETA — TOCA PARA FOTOGRAFIAR',
    addPhoto: 'AÑADIR FOTO',
    loadingRepPhoto: 'CARGANDO FOTO DEL REPRESENTANTE…',
    tapToMatch: 'TOCA LA FOTO PARA IGUALAR CON LA GUÍA',
    selectTagRep: 'ELIGE UNA ETIQUETA PARA VER LA FOTO DEL REPRESENTANTE',
    selectTagRepPlus:
      'ELIGE UNA ETIQUETA DEL REPRESENTANTE — O CUALQUIER OTRA PARA AÑADIR UNA FOTO',
    selectTagPre: 'ELIGE UNA ETIQUETA PARA VER LA FOTO DE PREINSTALACIÓN',
    selectTagFree: 'ELIGE UNA ETIQUETA Y FOTOGRAFÍA — TOMA LAS QUE NECESITES',
    allShotsMatched: 'Listo — Todas las fotos coinciden',
    donePhotosTaken: 'Listo — {count} tomadas',
    scrollForDone: 'Desliza hacia abajo para Listo',
    scrollForMore: 'Más etiquetas abajo',
    repSale: 'REPRESENTANTE (VENTA)',
    tagMatched: '{tag} — Coincide',
    extraShotHint: 'Foto libre — sin guía. Documenta lo que el representante no captó.',
    looksGood: 'Se ve bien',

    scopeTitle: 'Verificar alcance del trabajo',
    scopeSub: 'Productos vendidos, medidas y colores — confirma o marca',
    scopePendingOne:
      '{count} discrepancia esperando al IM — la revisión no puede cerrarse hasta resolverla',
    scopePendingMany:
      '{count} discrepancias esperando al IM — la revisión no puede cerrarse hasta resolverlas',
    scopeAcknowledge: 'Confirmar — Sin alcance registrado',
    scopeDone: 'Listo — Alcance revisado',
    scopeNoProducts: 'No hay productos vendidos en este trabajo',
    scopeNoProductsBody:
      'No se adjuntó nada para verificar — el paquete del trabajo no tiene medidas, colores ni lista de productos.',
    scopeNoProductsAction:
      'Avisa a tu Gerente de Instalación antes de comenzar. Si continúas, no habrá alcance vendido registrado con el que comparar el trabajo terminado. Confirma abajo para continuar con la instalación.',
    scopeConfirmCorrect: 'Confirmar correcto',
    scopeDiscrepancy: 'Discrepancia',
    scopeConfirmed: 'Confirmado correcto',
    scopeUndo: 'deshacer',
    scopePending: 'PENDIENTE',
    scopeAwaitingIm: '{issue} — esperando resolución del IM',
    scopePhotoCountOne: ' • {count} foto',
    scopePhotoCountMany: ' • {count} fotos',
    scopeResolvedBy: 'Resuelto por el IM — {issue}',
    scopeSummary: '{confirmed} confirmados · {resolved} resueltos por el IM',
    scopeDiscrepancySent: 'Discrepancia enviada',
    scopeDiscrepancySentBody: 'Se notificó al IM y al representante.',

    retake: 'Volver a tomar',
    usePhoto: 'Usar foto',
    ghost: 'Guía',
    deletePhotoTitle: '¿Eliminar esta foto?',
    deletePhotoBody:
      'La foto n.º {number} se quitará de este trabajo y se eliminará del servidor. Tendrás que tomarla de nuevo.',
    delete: 'Eliminar',
    keep: 'Conservar',

    jobPacket: 'Paquete del trabajo',
    contractDetails: 'Detalles del contrato',
    products: 'Productos',
    view: 'Ver',
    pages: '{count} páginas',
    contract: 'CONTRATO',
    downPayment: 'PAGO INICIAL',
    remainingBalance: 'SALDO RESTANTE',
    loanAuth: 'AUTORIZACIÓN DE PRÉSTAMO',
  },
};

export type Language = 'en' | 'es';

export const DICTIONARIES: Record<Language, TranslationTree> = {
  en: en as unknown as TranslationTree,
  es,
};

/** Dotted key of any string, e.g. `installer.tabAll`. */
export type TranslationKey = {
  [Group in keyof typeof en]: `${Group & string}.${keyof (typeof en)[Group] & string}`;
}[keyof typeof en];
