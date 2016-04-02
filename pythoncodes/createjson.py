import json as j
from copy import deepcopy
la=[]
lb=[]
jd = {"nodes":la,"edges":lb}
# for the node 
k = {}
k['id'] = "1"
k['cluster']= "1"
k['title'] = "Abc"
k["relatedness"]="0.5"
jd['nodes'].append(deepcopy(k))
print jd
k['id'] = "2"
k['cluster']= "2"
k['title'] = "two"
k["relatedness"]="0.5"
jd['nodes'].append(deepcopy(k))

#For the Edge
m = {}
m["source"] = "1"
m["target"] =  "2"
m["relatedness"] = "0.5"
jd['edges'].append(m)

prin = j.dumps(jd,indent = 4)
print prin

f = open("crea.json","w")
f.write(prin)
f.close()
