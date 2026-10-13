# Build-time: derive packs/*.json from engine output frozen in ms3-vectors.json (sutra is never hand-written).
import json,os
here=os.path.dirname(os.path.abspath(__file__))
v=json.load(open(os.environ.get('VECTORS',os.path.join(here,'..','..','..','ms3-vectors.json'))))
cs={c['id']:c for c in v['cases']}
DOM={'physics':'Physics','chemistry':'Chemistry','biology':'Biology'}
# English prose per item: (title, {symbol: legend}, units, meaning). Illustrative, not engine-verified.
T={
'ph-boltzmann':('Boltzmann factor',{'E':'energy of the state','k':'Boltzmann constant','T':'absolute temperature'},'E and kT in the same energy unit; result dimensionless','Relative occupation of a state of energy E at temperature T.'),
'ph-planck':('Planck spectral shape',{'x':'h*nu/(k*T), dimensionless'},'dimensionless','Shape of the Planck spectrum in the reduced variable x; peaks near x of about 2.82.'),
'ph-lorentz':('Lorentz factor',{'v':'speed in units of c'},'dimensionless, v < 1','Time dilation and length contraction factor; diverges as v approaches 1.'),
'ph-coulomb':('Inverse-square force',{'k':'coupling constant','q':'first charge (or mass)','Q':'second charge (or mass)','r':'separation'},'force = k q Q / r^2 in consistent units','Coulomb force (Newton gravity has the same form with a sign).'),
'ph-oscillator':('Harmonic oscillator',{'A':'amplitude','w':'angular frequency','t':'time'},'A in length, w in 1/time, t in time','Displacement of an undamped oscillator started at its maximum.'),
'ph-gauss':('Gaussian envelope',{'x':'position','s':'width (standard deviation)'},'x and s in the same length unit','Unnormalised Gaussian wave-packet envelope.'),
'ch-arrhenius':('Arrhenius rate constant',{'A':'pre-exponential factor','E':'activation energy','R':'gas constant','T':'absolute temperature'},'E/(R T) dimensionless; result in the unit of A','Reaction rate constant rising steeply with temperature.'),
'ch-nernst':('Nernst potential',{'U':'standard potential','R':'gas constant','T':'absolute temperature','n':'electrons transferred','F':'Faraday constant','Q':'reaction quotient'},'volts when R T/(n F) is in volts','Electrode potential shifted from standard by the reaction quotient.'),
'ch-henderson':('Henderson-Hasselbalch',{'p':'pKa','b':'base concentration','a':'acid concentration'},'pH is dimensionless; b/a a ratio','pH of a buffer from its base to acid ratio.'),
'ch-firstorder':('First-order decay',{'c':'initial concentration','k':'rate constant','t':'time'},'k in 1/time; result in the unit of c','Concentration of a species decaying at a rate proportional to itself.'),
'ch-idealgas':('Ideal gas law',{'n':'amount of substance','R':'gas constant','T':'absolute temperature','V':'volume'},'pressure in the unit implied by R','Pressure of an ideal gas; P = n R T / V.'),
'ch-langmuir':('Langmuir isotherm',{'K':'adsorption equilibrium constant','p':'gas pressure'},'coverage fraction, dimensionless; K p dimensionless','Fractional surface coverage saturating at 1.'),
'bi-logistic':('Logistic growth',{'K':'carrying capacity','N':'initial population','r':'growth rate','t':'time'},'population units; r in 1/time','Population growing to a carrying capacity in an S-shaped curve.'),
'bi-michaelis':('Michaelis-Menten rate',{'V':'maximum rate','S':'substrate concentration','K':'Michaelis constant'},'rate units; S and K same concentration unit','Enzyme reaction rate saturating at V.'),
'bi-hill':('Hill equation, n = 2',{'S':'ligand concentration','K':'half-saturation constant'},'fraction bound, dimensionless','Cooperative binding with Hill coefficient 2.'),
'bi-gompertz':('Gompertz growth',{'K':'asymptote','b':'displacement','c':'growth rate','t':'time'},'K in population units; c in 1/time','Asymmetric sigmoid growth used for tumours and populations.'),
'bi-hardyweinberg':('Hardy-Weinberg heterozygotes',{'p':'allele frequency'},'frequency, dimensionless, 0 to 1','Expected heterozygote frequency 2 p (1-p) in an ideal population.'),
'bi-expgrowth':('Exponential growth',{'N':'initial population','r':'growth rate','t':'time'},'population units; r in 1/time','Unbounded growth at a constant relative rate.'),
}
out={}
for c in v['cases']:
    if c['feature'] in DOM and c['id'].endswith('-in'):
        b=c['id'][:-3]; w=c['want']; val=cs[b+'-val']; smp=cs[b+'-smp']
        st2id={r['stem']:r['identifier'] for r in w['resolved']}
        ax=smp['req']['axes'][0]
        title,leg,units,mean=T[b]
        out.setdefault(c['feature'],[]).append({
         'id':b,'domain':c['feature'],'title':title,'plain':c['req']['input'],
         'sutra':w['sutra'],'declarations':w['declarations'],'latex':w['latex'],'gloss_en':w['gloss_en'],
         'env':w['env'],'resolved':w['resolved'],
         'params':{st2id[s]:x for s,x in val['req']['vals'].items()},
         'axis':{'name':st2id[ax['name']],'lo':ax['lo'],'hi':ax['hi'],'n':ax['n']},
         'legend':leg,'units':units,'meaning':mean,
         'status':'physical commentary illustrative, not engine-verified; title is a proposal pending owner ruling',
         'oracle_note':c['note']})
for d,items in out.items():
    json.dump({'domain':d,'label':DOM[d],'engine_rev':v['engine_rev'],'items':items},open(os.path.join(here,'..','packs',d+'.json'),'w'),ensure_ascii=False,indent=1)
    print(d,len(items))
