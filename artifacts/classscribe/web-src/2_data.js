/* ---------- Example library (clearly labelled, in-memory only) ---------- */
function isoOffset(n){const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function buildExamples(){
  const D=isoOffset;
  const courses={
    'ex-bio':{id:'ex-bio',ex:true,code:'BIO 101',name:'Introduction to Biology',professor:'Prof. Williams',semester:'Fall 2026',color:1,created:1},
    'ex-chem':{id:'ex-chem',ex:true,code:'CHEM 110',name:'General Chemistry I',professor:'Prof. Okafor',semester:'Fall 2026',color:2,created:2}
  };
  const P='P',S='S';
  const lectures={
  'ex-bio-1':{id:'ex-bio-1',ex:true,courseId:'ex-bio',title:'Cells and the Cell Cycle',date:D(-16),module:'Unit 1 · Cells',duration:2940,reviewed:false,
    speakers:{P:'Prof. Williams',S:'Student'},marks:[980,2700],slides:[{t:770,text:'Slide: “The Cell Cycle” — circular diagram. Interphase (G1 → S → G2) takes ~90% of the cycle; M phase = mitosis + cytokinesis.'}],
    segs:[
      {t:0,s:P,x:'Good morning everyone. Today we start Unit 1, which is really the foundation for everything in this course: the cell, and how cells divide.'},
      {t:45,s:P,x:'All living things are made of cells, and every cell comes from a pre-existing cell. That is cell theory, and I want you to be able to state all three parts of it.'},
      {t:160,s:P,x:'Eukaryotic cells have a nucleus that holds the DNA. Prokaryotic cells, like bacteria, do not. Their DNA sits in a region called the nucleoid.'},
      {t:420,s:S,x:'Is the nucleoid surrounded by anything, like a membrane?'},
      {t:432,s:P,x:'Good question. No, it is not membrane-bound. That is exactly the distinction.'},
      {t:760,s:P,x:'Now the cell cycle. There are two big phases: interphase and the mitotic phase. A cell spends roughly ninety percent of its life in interphase.'},
      {t:980,s:P,x:'Interphase has three parts: G1, S, and G2. S stands for synthesis. That is when DNA is replicated. If you remember one thing today, remember that DNA replication happens in S phase.'},
      {t:1320,s:P,x:'Cell division is going to come up again and again this semester, so get comfortable with this cycle diagram now.'},
      {t:1710,s:P,x:'Checkpoints control the cycle. The G1 checkpoint asks: is the cell big enough, is the DNA undamaged? If not, the cell can enter G0, a resting state.'},
      {t:2080,s:P,x:'When checkpoints fail, cells divide uncontrollably. That is the basic story of cancer, and we will return to it in Unit 3.'},
      {t:2400,s:S,x:'Will we need to know the specific checkpoint proteins?'},
      {t:2415,s:P,x:'For this course, know the three checkpoints and what each one checks. For the proteins, cyclins and CDKs, just know the names.'},
      {t:2700,s:P,x:'For Wednesday, read chapter 12, sections 1 and 2. Problem set one is due next Friday at midnight on Canvas.'}
    ],
    analysis:{
      summary:'Prof. Williams opened Unit 1 with cell theory and the difference between eukaryotic and prokaryotic cells, then walked through the cell cycle: interphase (G1, S, G2), the mitotic phase, and the checkpoints that control it.',
      keyPoints:['Cell theory has three parts: all life is made of cells, the cell is the basic unit of life, and cells come from pre-existing cells.','Eukaryotes keep DNA in a nucleus; prokaryotes keep it in a nucleoid that is not membrane-bound.','The cell cycle = interphase (~90% of the time) + the mitotic phase.','DNA replication happens during S phase of interphase.','Checkpoints at G1, G2 and M decide whether the cycle continues; failure can lead to cancer.'],
      emphasized:[{concept:'DNA replication happens in S phase',why:'“If you remember one thing today…”',t:980},{concept:'The cell cycle diagram',why:'Said cell division will “come up again and again this semester”',t:1320},{concept:'Cell theory (all three parts)',why:'Asked students to be able to state it',t:45}],
      terms:[{term:'Cell theory',def:'All living things are made of cells; the cell is the basic unit of life; every cell comes from a pre-existing cell.',t:45},{term:'Eukaryote',def:'An organism whose cells have a membrane-bound nucleus.',t:160},{term:'Prokaryote',def:'A single-celled organism without a nucleus, such as a bacterium.',t:160},{term:'Nucleoid',def:'The region of a prokaryotic cell where DNA sits; not enclosed by a membrane.',t:160},{term:'Interphase',def:'The G1, S and G2 portion of the cell cycle, about 90% of it.',t:760},{term:'S phase',def:'The synthesis stage of interphase, when DNA is replicated.',t:980},{term:'G0',def:'A resting state a cell can enter when it fails the G1 checkpoint.',t:1710},{term:'Cyclins and CDKs',def:'Regulatory proteins that drive the cell through checkpoints (names only for this course).',t:2415}],
      examples:[{kind:'process',text:'Interphase: G1 → S → G2, then mitosis and cytokinesis',t:760},{kind:'case',text:'Checkpoint failure leading to uncontrolled division (cancer)',t:2080},{kind:'example',text:'Bacteria as prokaryotes with a nucleoid',t:160}],
      assignments:[{title:'Read chapter 12, §1–2',type:'reading',due:D(-14),t:2700},{title:'Problem set 1',type:'homework',due:D(-7),t:2700}],
      announcements:['Problem sets are submitted on Canvas by midnight.'],
      studentQuestions:[{q:'Is the nucleoid surrounded by a membrane?',t:420},{q:'Do we need to know the specific checkpoint proteins?',t:2400}],
      concepts:['Cell division','Cell cycle','Cell theory','DNA replication','Checkpoints'],
      notes:'## Cell theory\n- All living things are made of cells\n- The cell is the basic unit of life\n- Every cell comes from a pre-existing cell\n\n## Eukaryotes vs. prokaryotes\n- **Eukaryotes:** DNA inside a membrane-bound nucleus\n- **Prokaryotes** (bacteria): DNA in the **nucleoid**, no membrane\n\n## The cell cycle\n- **Interphase** (~90%): G1 → **S (DNA replication)** → G2\n- **Mitotic phase:** mitosis + cytokinesis\n\n## Checkpoints\n- G1: is the cell big enough, is DNA undamaged? If not → **G0**\n- Also G2 and M checkpoints; know what each checks\n- Regulators: cyclins and CDKs (names only)\n- Failure → uncontrolled division → cancer (Unit 3)',
      quiz:[{q:'During which phase is DNA replicated?',choices:['G1','S phase','Metaphase','Cytokinesis'],answer:1,explain:'S stands for synthesis: DNA is copied during S phase of interphase.',concept:'DNA replication',t:980},{q:'Where is DNA located in a prokaryotic cell?',choices:['Nucleus','Mitochondria','Nucleoid','Golgi body'],answer:2,explain:'Prokaryotes keep DNA in the nucleoid, which is not membrane-bound.',concept:'Cell theory',t:160},{q:'What can a cell do if it fails the G1 checkpoint?',choices:['Skip to anaphase','Enter G0','Divide twice','Become prokaryotic'],answer:1,explain:'Failing G1 can send the cell into the resting state G0.',concept:'Checkpoints',t:1710}]
    }},
  'ex-bio-2':{id:'ex-bio-2',ex:true,courseId:'ex-bio',title:'Mitosis, Step by Step',date:D(-14),module:'Unit 1 · Cells',duration:2820,reviewed:false,
    speakers:{P:'Prof. Williams',S:'Student'},marks:[780],slides:[],
    segs:[
      {t:0,s:P,x:'Last time we ended with interphase. Today is the mitotic phase itself: mitosis, then cytokinesis.'},
      {t:120,s:P,x:'The stages are prophase, prometaphase, metaphase, anaphase and telophase. A mnemonic if you want one: People Please Make Another Tea.'},
      {t:400,s:P,x:'In prophase, chromatin condenses into visible chromosomes. Each chromosome is two sister chromatids joined at the centromere.'},
      {t:780,s:P,x:'Metaphase: chromosomes line up at the metaphase plate. This is the stage you will most often be asked to identify in a micrograph. I will say it again: identify metaphase by that single line of chromosomes.'},
      {t:1150,s:S,x:'What actually pulls the chromatids apart?'},
      {t:1162,s:P,x:'The spindle fibers, which are microtubules attached at the kinetochore. In anaphase they shorten and the sister chromatids separate to opposite poles.'},
      {t:1600,s:P,x:'Telophase reverses prophase: the nuclear envelopes re-form. Then cytokinesis splits the cytoplasm. Animal cells form a cleavage furrow; plant cells build a cell plate.'},
      {t:2000,s:P,x:'Cell division by mitosis gives two genetically identical daughter cells. Keep that in mind, because next week meiosis gives you the opposite.'},
      {t:2300,s:P,x:'Remember, DNA was already copied in S phase. Mitosis does not copy DNA; it distributes it.'},
      {t:2600,s:P,x:'Bring your lab notebook Thursday. And quiz one is next Wednesday, covering Unit 1 through today.'}
    ],
    analysis:{
      summary:'A walkthrough of the stages of mitosis and cytokinesis, with extra attention on recognizing metaphase and on the fact that mitosis distributes DNA that was already copied in S phase.',
      keyPoints:['Mitosis stages: prophase, prometaphase, metaphase, anaphase, telophase.','Each chromosome is two sister chromatids joined at the centromere.','Metaphase is recognizable by chromosomes aligned in a single line at the metaphase plate.','Spindle microtubules attached at kinetochores pull sister chromatids apart in anaphase.','Mitosis produces two genetically identical daughter cells; it does not copy DNA.'],
      emphasized:[{concept:'Identifying metaphase in a micrograph',why:'Repeated twice: “I will say it again”',t:780},{concept:'Mitosis makes identical daughter cells',why:'Set up as the contrast with meiosis next week',t:2000},{concept:'DNA is copied in S phase, not in mitosis',why:'Callback to Lecture 1 emphasis',t:2300}],
      terms:[{term:'Sister chromatids',def:'The two identical copies of a chromosome, joined at the centromere.',t:400},{term:'Centromere',def:'The region where sister chromatids are joined.',t:400},{term:'Metaphase plate',def:'The plane at the cell’s middle where chromosomes line up in metaphase.',t:780},{term:'Kinetochore',def:'Protein structure on the centromere where spindle microtubules attach.',t:1162},{term:'Cytokinesis',def:'Division of the cytoplasm after mitosis.',t:1600},{term:'Cleavage furrow',def:'The pinching-in that divides an animal cell during cytokinesis.',t:1600},{term:'Cell plate',def:'The new wall that divides a plant cell during cytokinesis.',t:1600}],
      examples:[{kind:'process',text:'Prophase → prometaphase → metaphase → anaphase → telophase (“People Please Make Another Tea”)',t:120},{kind:'example',text:'Animal cells: cleavage furrow. Plant cells: cell plate.',t:1600}],
      assignments:[{title:'Quiz 1 (Unit 1 through mitosis)',type:'quiz',due:D(-7),t:2600}],
      announcements:['Bring your lab notebook Thursday.'],
      studentQuestions:[{q:'What pulls the chromatids apart?',t:1150}],
      concepts:['Cell division','Mitosis','Metaphase','Spindle fibers','DNA replication'],
      notes:'## Stages of mitosis\n1. **Prophase:** chromatin condenses; chromosome = 2 sister chromatids at the centromere\n2. **Prometaphase**\n3. **Metaphase:** single line at the metaphase plate (know how to spot it)\n4. **Anaphase:** spindle microtubules (at kinetochores) shorten; chromatids separate\n5. **Telophase:** nuclear envelopes re-form\n\n## Cytokinesis\n- Animal cells: cleavage furrow\n- Plant cells: cell plate\n\n## Big ideas\n- Mitosis → 2 genetically identical daughter cells\n- Mitosis **distributes** DNA; it was copied in S phase',
      quiz:[{q:'Which stage shows chromosomes lined up in a single row at the cell’s middle?',choices:['Prophase','Metaphase','Anaphase','Telophase'],answer:1,explain:'Metaphase is identified by the single line of chromosomes at the metaphase plate.',concept:'Metaphase',t:780},{q:'What attaches spindle microtubules to a chromosome?',choices:['Centromere','Kinetochore','Cell plate','Nucleoid'],answer:1,explain:'Microtubules attach at the kinetochore, a protein structure on the centromere.',concept:'Spindle fibers',t:1162},{q:'Mitosis produces…',choices:['Four different cells','Two identical daughter cells','Gametes','Copies of DNA'],answer:1,explain:'Mitosis produces two genetically identical daughter cells.',concept:'Mitosis',t:2000}]
    }},
  'ex-bio-3':{id:'ex-bio-3',ex:true,courseId:'ex-bio',title:'DNA Replication',date:D(-9),module:'Unit 2 · Genetics',duration:3000,reviewed:false,
    speakers:{P:'Prof. Williams',S:'Student'},marks:[900],slides:[],
    segs:[
      {t:0,s:P,x:'We have said a few times that DNA is copied in S phase. Today we finally look at how.'},
      {t:140,s:P,x:'Replication is semiconservative. Each new double helix keeps one original strand and gets one new strand. Meselson and Stahl showed this in 1958.'},
      {t:520,s:P,x:'Helicase unzips the helix at the replication fork. Primase lays down an RNA primer. DNA polymerase then adds nucleotides, but only in the five-prime to three-prime direction.'},
      {t:900,s:P,x:'That one-direction rule is the key idea today. It is why we have a leading strand, built continuously, and a lagging strand, built in pieces.'},
      {t:1210,s:S,x:'Why can’t polymerase just go the other way?'},
      {t:1225,s:P,x:'It needs a free three-prime hydroxyl to attach the next nucleotide. Chemistry, not preference.'},
      {t:1500,s:P,x:'The pieces on the lagging strand are Okazaki fragments. DNA ligase seals them together.'},
      {t:1900,s:P,x:'Base pairing: A with T, G with C. So if one strand reads A-T-G-C, the partner reads T-A-C-G.'},
      {t:2350,s:P,x:'Cell division depends on accurate replication. Polymerase proofreads, ending up at about one error per billion bases after repair.'},
      {t:2800,s:P,x:'The midterm is three weeks from today and covers Units 1 and 2. Read chapter 16 before Monday.'}
    ],
    analysis:{
      summary:'How DNA is copied: semiconservative replication, the enzymes at the replication fork, and why the 5′→3′ rule creates leading and lagging strands. The midterm date was announced.',
      keyPoints:['Replication is semiconservative (Meselson & Stahl, 1958).','Helicase unwinds, primase adds an RNA primer, DNA polymerase extends.','Polymerase only builds 5′→3′ because it needs a free 3′ hydroxyl.','Leading strand is continuous; lagging strand is built as Okazaki fragments joined by ligase.','Base pairing: A–T and G–C; proofreading leaves about 1 error per billion bases.'],
      emphasized:[{concept:'The 5′→3′ direction rule',why:'Called “the key idea today”',t:900},{concept:'DNA replication happens in S phase',why:'“We have said a few times…”',t:0}],
      terms:[{term:'Semiconservative replication',def:'Each new DNA molecule has one original strand and one new strand.',t:140},{term:'Helicase',def:'Enzyme that unwinds the double helix at the replication fork.',t:520},{term:'Primase',def:'Enzyme that lays down a short RNA primer.',t:520},{term:'DNA polymerase',def:'Enzyme that adds nucleotides in the 5′→3′ direction.',t:520},{term:'Leading strand',def:'The strand built continuously toward the fork.',t:900},{term:'Lagging strand',def:'The strand built in pieces away from the fork.',t:900},{term:'Okazaki fragments',def:'Short DNA pieces on the lagging strand.',t:1500},{term:'DNA ligase',def:'Enzyme that seals Okazaki fragments together.',t:1500}],
      examples:[{kind:'person',text:'Meselson and Stahl (1958) showed replication is semiconservative',t:140},{kind:'formula',text:'Base pairing: A–T, G–C (ATGC ↔ TACG)',t:1900},{kind:'date',text:'1958',t:140}],
      assignments:[{title:'Midterm (Units 1–2)',type:'exam',due:D(12),t:2800},{title:'Read chapter 16',type:'reading',due:D(-5),t:2800}],
      announcements:['Midterm covers Units 1 and 2.'],
      studentQuestions:[{q:'Why can’t polymerase go the other way?',t:1210}],
      concepts:['DNA replication','Cell division','Semiconservative replication','Leading & lagging strands','Base pairing'],
      notes:'## Semiconservative replication\n- New helix = 1 old strand + 1 new strand\n- Shown by Meselson & Stahl (1958)\n\n## At the replication fork\n- **Helicase** unwinds\n- **Primase** adds RNA primer\n- **DNA polymerase** adds nucleotides **5′→3′ only** (needs free 3′-OH)\n\n## Leading vs. lagging\n- Leading: continuous\n- Lagging: **Okazaki fragments**, sealed by **ligase**\n\n## Accuracy\n- A–T, G–C pairing\n- Proofreading → ~1 error per billion bases',
      quiz:[{q:'Why is the lagging strand made in fragments?',choices:['Helicase is slow','Polymerase only builds 5′→3′','Primase is missing','Ligase cuts it'],answer:1,explain:'Polymerase can only add to a free 3′ end, so one strand must be built in pieces.',concept:'Leading & lagging strands',t:900},{q:'If one strand reads A-T-G-C, the partner reads:',choices:['A-T-G-C','T-A-C-G','G-C-A-T','U-A-C-G'],answer:1,explain:'A pairs with T and G pairs with C.',concept:'Base pairing',t:1900},{q:'What seals Okazaki fragments?',choices:['Primase','Helicase','DNA ligase','Kinetochore'],answer:2,explain:'DNA ligase joins the fragments.',concept:'Leading & lagging strands',t:1500}]
    }},
  'ex-chem-1':{id:'ex-chem-1',ex:true,courseId:'ex-chem',title:'The Mole and Molar Mass',date:D(-15),module:'Chapter 3',duration:3000,reviewed:false,
    speakers:{P:'Prof. Okafor',S:'Student'},marks:[610],slides:[],
    segs:[
      {t:0,s:P,x:'Today is the single most useful idea in this course: the mole.'},
      {t:210,s:P,x:'One mole is 6.022 times ten to the twenty-third particles. That is Avogadro’s number. Write it on the inside cover of your notebook.'},
      {t:610,s:P,x:'Molar mass is grams per mole. Water is about 18.02 grams per mole: two hydrogens at 1.008 and one oxygen at 16.00.'},
      {t:1300,s:S,x:'Do we always round to two decimals?'},
      {t:1310,s:P,x:'Use the significant figures in the problem. I grade sig figs on the exam, so yes, it matters.'},
      {t:2100,s:P,x:'Converting grams to moles: divide by molar mass. Moles to particles: multiply by Avogadro’s number. Practice this until it is automatic.'},
      {t:2800,s:P,x:'Homework 2 is due next Tuesday. Exam 1 is coming up; it covers chapters 1 through 4.'}
    ],
    analysis:{
      summary:'Introduction to the mole, Avogadro’s number and molar mass, with conversion practice between grams, moles and particles. Significant figures will be graded.',
      keyPoints:['1 mol = 6.022 × 10²³ particles (Avogadro’s number).','Molar mass (g/mol) is the sum of atomic masses; water ≈ 18.02 g/mol.','grams ÷ molar mass = moles; moles × 6.022×10²³ = particles.','Significant figures are graded on exams.'],
      emphasized:[{concept:'Avogadro’s number',why:'“Write it on the inside cover of your notebook”',t:210},{concept:'Significant figures',why:'“I grade sig figs on the exam”',t:1310},{concept:'Gram ↔ mole ↔ particle conversions',why:'“Practice this until it is automatic”',t:2100}],
      terms:[{term:'Mole',def:'6.022 × 10²³ particles of a substance.',t:0},{term:'Avogadro’s number',def:'6.022 × 10²³, the number of particles in one mole.',t:210},{term:'Molar mass',def:'Mass of one mole of a substance, in g/mol.',t:610}],
      examples:[{kind:'formula',text:'moles = grams ÷ molar mass',t:2100},{kind:'formula',text:'particles = moles × 6.022×10²³',t:2100},{kind:'example',text:'H₂O: 2(1.008) + 16.00 = 18.02 g/mol',t:610}],
      assignments:[{title:'Homework 2',type:'homework',due:D(-10),t:2800}],
      announcements:['Exam 1 covers chapters 1–4.'],
      studentQuestions:[{q:'Do we always round to two decimals?',t:1300}],
      concepts:['The mole','Molar mass','Significant figures','Unit conversions'],
      notes:'## The mole\n- 1 mol = **6.022 × 10²³** particles\n\n## Molar mass\n- g/mol = sum of atomic masses\n- H₂O: 2(1.008) + 16.00 = **18.02 g/mol**\n\n## Conversions\n- grams → moles: ÷ molar mass\n- moles → particles: × Avogadro’s number\n\n## Exam note\n- Sig figs are graded',
      quiz:[{q:'How many moles are in 36.04 g of water?',choices:['0.5 mol','1.00 mol','2.000 mol','18.02 mol'],answer:2,explain:'36.04 g ÷ 18.02 g/mol = 2.000 mol (four sig figs).',concept:'Unit conversions',t:2100},{q:'Avogadro’s number is…',choices:['6.022 × 10²³','3.00 × 10⁸','1.008','9.81'],answer:0,explain:'One mole contains 6.022 × 10²³ particles.',concept:'The mole',t:210}]
    }},
  'ex-chem-2':{id:'ex-chem-2',ex:true,courseId:'ex-chem',title:'Stoichiometry and Limiting Reagents',date:D(-8),module:'Chapter 4',duration:3060,reviewed:false,
    speakers:{P:'Prof. Okafor',S:'Student'},marks:[1500],slides:[],
    segs:[
      {t:0,s:P,x:'Stoichiometry is just the mole idea applied to reactions. The balanced equation gives you mole ratios.'},
      {t:420,s:P,x:'Always balance first. Two H2 plus O2 gives two H2O. The ratio of hydrogen to water is two to two, or one to one.'},
      {t:1500,s:P,x:'The limiting reagent is the one that runs out first. It decides how much product you get. This shows up on every exam I have ever written.'},
      {t:1900,s:S,x:'How do you find it quickly?'},
      {t:1915,s:P,x:'Convert each reactant to moles of product. Whichever gives the smaller amount is limiting.'},
      {t:2500,s:P,x:'Percent yield is actual over theoretical times one hundred.'},
      {t:2950,s:P,x:'Exam 1 is on the date in the syllabus. Bring a scientific calculator; phones are not allowed.'}
    ],
    analysis:{
      summary:'Using balanced equations for mole ratios, finding the limiting reagent, and calculating percent yield. Calculator rules for Exam 1 were announced.',
      keyPoints:['Balance the equation first; coefficients give mole ratios.','The limiting reagent runs out first and sets the amount of product.','Find it by converting each reactant to moles of product and taking the smaller.','Percent yield = actual ÷ theoretical × 100.'],
      emphasized:[{concept:'Limiting reagent',why:'“Shows up on every exam I have ever written”',t:1500},{concept:'Balance equations first',why:'“Always balance first”',t:420}],
      terms:[{term:'Stoichiometry',def:'Using mole ratios from a balanced equation to relate amounts of reactants and products.',t:0},{term:'Limiting reagent',def:'The reactant that is used up first, limiting the product formed.',t:1500},{term:'Theoretical yield',def:'The maximum product predicted from the limiting reagent.',t:1915},{term:'Percent yield',def:'Actual yield ÷ theoretical yield × 100.',t:2500}],
      examples:[{kind:'formula',text:'2 H₂ + O₂ → 2 H₂O',t:420},{kind:'formula',text:'% yield = actual ÷ theoretical × 100',t:2500}],
      assignments:[{title:'Exam 1 (Chapters 1–4)',type:'exam',due:D(5),t:2950}],
      announcements:['Bring a scientific calculator to Exam 1; phones are not allowed.'],
      studentQuestions:[{q:'How do you find the limiting reagent quickly?',t:1900}],
      concepts:['Stoichiometry','Limiting reagent','Unit conversions','Percent yield','The mole'],
      notes:'## Stoichiometry\n- Balance first; coefficients = mole ratios\n- 2 H₂ + O₂ → 2 H₂O\n\n## Limiting reagent\n- Runs out first; sets product amount\n- Convert each reactant → moles of product; smaller wins\n\n## Percent yield\n- actual ÷ theoretical × 100\n\n## Exam 1\n- Scientific calculator; no phones',
      quiz:[{q:'The limiting reagent is the reactant that…',choices:['Has the largest mass','Runs out first','Is in excess','Has the highest molar mass'],answer:1,explain:'It is used up first and limits product formed.',concept:'Limiting reagent',t:1500},{q:'Actual yield 8.0 g, theoretical 10.0 g. Percent yield?',choices:['8%','80.%','125%','18%'],answer:1,explain:'8.0 ÷ 10.0 × 100 = 80.%',concept:'Percent yield',t:2500}]
    }}
  };
  const assignments={};
  Object.values(lectures).forEach(l=>(l.analysis.assignments||[]).forEach((a,i)=>{const id=l.id+'-a'+i;assignments[id]={id,ex:true,courseId:l.courseId,title:a.title,type:a.type,due:a.due,lectureId:l.id,t:a.t,done:a.due<isoOffset(0)}}));
  return {courses,lectures,assignments};
}

/* Demo lecture streamed on the Capture screen */
const DEMO_LECTURE=[
  {t:4,s:'P',x:'Alright, let’s get started. Last week was mitosis. Today is meiosis, and I want you to watch for how it differs.'},
  {t:31,s:'P',x:'Meiosis makes four cells, not two, and each has half the chromosome number. We call those haploid cells.'},
  {t:62,s:'P',x:'The key event is crossing over in prophase one. Homologous chromosomes swap segments. This is the source of genetic variation, and it will be on the midterm.'},
  {t:95,s:'S',x:'Does crossing over happen in mitosis too?'},
  {t:104,s:'P',x:'Good question. No. Crossing over is specific to meiosis one. That is one of the biggest differences.'},
  {t:140,s:'P',x:'Meiosis one separates homologous pairs. Meiosis two separates sister chromatids, which looks a lot like mitosis.'},
  {t:176,s:'P',x:'So remember: mitosis, two identical diploid cells. Meiosis, four genetically different haploid cells. I will repeat that because it matters.'},
  {t:210,s:'P',x:'For Friday, read chapter 13 and finish problem set three. It is due Friday at midnight.'}
];
