import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

import {
  addSkill,
  deleteSkill,
  extractSkills,
  getJD,
  getSkills,
  uploadJDFile,
  updateSkill,
} from '../api/jdApi'
import AppShell from '../components/AppShell'
import { AlertBanner, Badge, Card, CardTitle, PrimaryBtn, SecondaryBtn } from '../components/ui'

function toCommaText(subtopics) {
  return (subtopics || []).join(', ')
}

function fromCommaText(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function buildCard(skill) {
  return {
    local_id: `existing-${skill.id}`,
    ...skill,
    subtopics_text: toCommaText(skill.subtopics),
    isNew: false,
    isModified: false,
    isEditing: false,
    editSnapshot: null,
    original: {
      skill_name: skill.skill_name,
      importance_level: skill.importance_level || '',
      subtopics_text: toCommaText(skill.subtopics),
    },
  }
}

function getSkillTypeVariant(skillType) {
  if (skillType === 'primary') return 'blue'
  if (skillType === 'soft') return 'green'
  return 'gray'
}

export default function SkillExtraction() {
  const navigate = useNavigate()
  const { jdId } = useParams()
  const [jd, setJD] = useState(null)
  const [skillCards, setSkillCards] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isExtracting, setIsExtracting] = useState(false)
  const [savingRowId, setSavingRowId] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileInputRef = useRef(null)

  const rawPreview = useMemo(() => {
    const raw = jd?.raw_text || ''
    if (raw.length <= 300) return raw
    return `${raw.slice(0, 300)}...`
  }, [jd])

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      if (!jdId) {
        setIsLoading(false)
        setError('Invalid JD id.')
        return
      }

      try {
        setIsLoading(true)
        setError('')

        const [jdResponse, skillsResponse] = await Promise.all([
          getJD(jdId),
          getSkills(jdId),
        ])


        if (!isMounted) {
          return
        }

        setJD(jdResponse.data?.jd ?? null)
        const incomingSkills = skillsResponse.data?.skills ?? []
        setSkillCards(incomingSkills.map(buildCard))
      } catch (_loadError) {
        if (!isMounted) {
          return
        }
        setError('Unable to load JD details.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [jdId])

  function updateCardField(localId, field, value) {
    setSkillCards((previous) =>
      previous.map((card) => {
        if (card.local_id !== localId) return card

        const nextCard = {
          ...card,
          [field]: value,
        }

        if (!nextCard.isNew) {
          const hasChanges =
            nextCard.skill_name !== nextCard.original.skill_name
            || (nextCard.importance_level || '') !== nextCard.original.importance_level
            || nextCard.subtopics_text !== nextCard.original.subtopics_text

          nextCard.isModified = hasChanges
        }

        return nextCard
      }),
    )
  }

  async function handleExtract() {
    if (!jdId) return

    if (!jd?.raw_text || !jd.raw_text.trim()) {
      setError('No text to extract from. Upload a .pdf/.docx file first.')
      return
    }

    try {
      setIsExtracting(true)
      setError('')
      setSuccess('')


      await extractSkills(jdId)
      const skillsResponse = await getSkills(jdId)
      const refreshedSkills = skillsResponse.data?.skills ?? []


      setSkillCards(refreshedSkills.map(buildCard))
      setSuccess('Skills extracted successfully.')
    } catch (extractError) {
      setError('AI extraction failed — you can add skills manually')
    } finally {
      setIsExtracting(false)
    }
  }

  async function handleUploadJDFile() {
    if (!jdId) {
      setError('Invalid JD id.')
      return
    }

    if (!selectedFile) {
      setError('Please choose a .pdf or .docx file.')
      return
    }

    try {
      setIsUploading(true)
      setError('')
      setSuccess('')


      const uploadResponse = await uploadJDFile(jdId, selectedFile)
      const jdResponse = await getJD(jdId)
      setJD(jdResponse.data?.jd ?? null)

      if ((jdResponse.data?.jd?.raw_text || '').trim().length === 0) {
        setError('Upload succeeded, but no readable text was extracted from this file. Try a different file format/layout.')
        return
      }

      setSuccess('JD file uploaded. You can now extract skills.')
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (uploadError) {
      const apiError = uploadError?.response?.data
      if (apiError?.errors?.file) {
        setError(apiError.errors.file[0])
      } else {
        setError(apiError?.error || 'Failed to upload JD file.')
      }
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDeleteCard(localId) {
    const card = skillCards.find((entry) => entry.local_id === localId)
    if (!card) return

    try {
      setError('')
      if (!card.isNew) {
        await deleteSkill(jdId, card.id)
      }
      setSkillCards((previous) => previous.filter((entry) => entry.local_id !== localId))
    } catch (_deleteError) {
      setError('Failed to delete skill.')
    }
  }

  function handleAddManualSkill() {
    const localId = `new-${Date.now()}-${Math.random()}`
    setSkillCards((previous) => [
      ...previous,
      {
        local_id: localId,
        id: null,
        skill_name: '',
        skill_type: 'secondary',
        importance_level: '',
        subtopics: [],
        subtopics_text: '',
        isNew: true,
        isModified: true,
        isEditing: true,
        editSnapshot: null,
      },
    ])
  }

  function handleEditCard(localId) {
    setSkillCards((previous) =>
      previous.map((card) => {
        if (card.local_id !== localId || card.isEditing) return card

        return {
          ...card,
          isEditing: true,
          editSnapshot: {
            skill_name: card.skill_name,
            importance_level: card.importance_level || '',
            subtopics_text: card.subtopics_text || '',
            skill_type: card.skill_type || 'secondary',
          },
        }
      }),
    )
  }

  function handleCancelEdit(localId) {
    setSkillCards((previous) => {
      const card = previous.find((entry) => entry.local_id === localId)
      if (!card) return previous

      if (card.isNew) {
        return previous.filter((entry) => entry.local_id !== localId)
      }

      return previous.map((entry) => {
        if (entry.local_id !== localId) return entry

        const snapshot = entry.editSnapshot
        if (!snapshot) {
          return {
            ...entry,
            isEditing: false,
          }
        }

        return {
          ...entry,
          skill_name: snapshot.skill_name,
          importance_level: snapshot.importance_level,
          subtopics_text: snapshot.subtopics_text,
          skill_type: snapshot.skill_type,
          isEditing: false,
          isModified: false,
          editSnapshot: null,
        }
      })
    })
  }

  async function handleSaveCard(localId) {
    const card = skillCards.find((entry) => entry.local_id === localId)
    if (!card) return

    if (!card.skill_name.trim()) {
      setError('Skill name is required.')
      return
    }

    try {
      setSavingRowId(localId)
      setError('')
      setSuccess('')

      const payload = {
        skill_name: card.skill_name.trim(),
        importance_level: card.importance_level?.trim() || null,
        subtopics: fromCommaText(card.subtopics_text),
      }

      if (card.isNew) {
        await addSkill(jdId, {
          ...payload,
          skill_type: card.skill_type || 'secondary',
        })
      } else if (card.isModified) {
        await updateSkill(jdId, card.id, payload)
      }

      const skillsResponse = await getSkills(jdId)
      const refreshedSkills = skillsResponse.data?.skills ?? []
      setSkillCards(refreshedSkills.map(buildCard))
      setSuccess('Skill saved successfully.')
    } catch (_saveError) {
      setError('Failed to save skill.')
    } finally {
      setSavingRowId(null)
    }
  }

  function getExportRows() {
    return skillCards.map((card) => ({
      type: card.skill_type || 'secondary',
      skill_name: card.skill_name || '-',
      importance: card.importance_level || '-',
      subtopics: card.subtopics_text || '-',
    }))
  }

  function getExportFileBaseName() {
    const date = new Date().toISOString().slice(0, 10)
    return `jd-${jdId || 'unknown'}-skills-${date}`
  }

  function handleDownloadExcel() {
    const rows = getExportRows()
    if (rows.length === 0) {
      setError('No skills available to export.')
      return
    }

    try {
      setIsDownloadingExcel(true)
      setError('')

      const worksheet = XLSX.utils.json_to_sheet(
        rows.map((row) => ({
          Type: row.type,
          'Skill Name': row.skill_name,
          Importance: row.importance,
          Subtopics: row.subtopics,
        })),
      )
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Skills')
      XLSX.writeFile(workbook, `${getExportFileBaseName()}.xlsx`)
    } catch (_downloadError) {
      setError('Failed to export Excel.')
    } finally {
      setIsDownloadingExcel(false)
    }
  }

  function handleDownloadPdf() {
    const rows = getExportRows()
    if (rows.length === 0) {
      setError('No skills available to export.')
      return
    }

    try {
      setIsDownloadingPdf(true)
      setError('')

      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(12)
      doc.text(`Extracted Skills - ${jd?.title || `JD #${jdId}`}`, 14, 14)

      autoTable(doc, {
        startY: 20,
        head: [['Type', 'Skill Name', 'Importance', 'Subtopics']],
        body: rows.map((row) => [row.type, row.skill_name, row.importance, row.subtopics]),
        styles: {
          fontSize: 9,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [37, 99, 235],
        },
      })

      doc.save(`${getExportFileBaseName()}.pdf`)
    } catch (_downloadError) {
      setError('Failed to export PDF.')
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  if (isLoading) {
    return (
      <AppShell pageTitle="Skill Extraction">
        <div className="flex items-center justify-center gap-2.5 py-20 text-slate-500 text-sm">
          <span className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full spin" />
          Loading JD details...
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell pageTitle="Skill Extraction" pageSubtitle={jd?.title || `JD #${jdId}`}>
      <div className="flex items-center justify-start mb-5">
        <SecondaryBtn onClick={() => navigate('/jd')}>
          Back to Job Descriptions
        </SecondaryBtn>
      </div>

      <AlertBanner type="error" message={error} />
      <AlertBanner type="success" message={success} />

      {/* JD Details card */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <CardTitle>JD Details</CardTitle>
          {jd?.title && <Badge variant="blue">{jd.status || 'DRAFT'}</Badge>}
        </div>
        <div className="text-sm text-slate-700 mb-3">
          <strong>Title:</strong> {jd?.title || '-'}
        </div>
        <div className="text-sm text-slate-500 mb-2">
          <strong className="text-slate-700">Raw text length:</strong> {(jd?.raw_text || '').length} characters
        </div>
        <div className="raw-text-viewer mb-4">
          {(jd?.raw_text && jd.raw_text.trim()) ? jd.raw_text : 'No raw text available.'}
        </div>

        {(!jd?.raw_text || !jd.raw_text.trim()) && (
          <div>
            <label htmlFor="jd-upload" className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
              Upload JD (.pdf/.docx)
            </label>
            <div className="flex items-center gap-3 mt-2">
              <input
                ref={fileInputRef}
                id="jd-upload"
                type="file"
                accept=".pdf,.docx"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                className="text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <SecondaryBtn onClick={handleUploadJDFile} disabled={isUploading}>
                {isUploading ? 'Uploading...' : 'Upload File'}
              </SecondaryBtn>
            </div>
          </div>
        )}
      </Card>

      {/* Skills table card */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Extracted Skills
            {skillCards.length > 0 && (
              <span className="ml-2 text-xs font-normal text-slate-500">({skillCards.length} skills)</span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <SecondaryBtn
              disabled={isExtracting || isDownloadingExcel || skillCards.length === 0}
              onClick={handleDownloadExcel}
            >
              {isDownloadingExcel ? 'Downloading...' : 'Excel'}
            </SecondaryBtn>
            <SecondaryBtn
              disabled={isExtracting || isDownloadingPdf || skillCards.length === 0}
              onClick={handleDownloadPdf}
            >
              {isDownloadingPdf ? 'Downloading...' : 'PDF'}
            </SecondaryBtn>
            <PrimaryBtn
              disabled={isExtracting || !jd?.raw_text}
              onClick={handleExtract}
              title={!jd?.raw_text ? 'Upload a JD file or paste text before extracting skills' : undefined}
              loading={isExtracting}
            >
              {isExtracting ? 'Analysing...' : 'Extract Skills'}
            </PrimaryBtn>
          </div>
        </div>

        {isExtracting && (
          <div className="flex items-center justify-center gap-2.5 py-6 text-slate-500 text-sm border-b border-slate-100 mb-4">
            <span className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full spin" />
            Analysing JD with GPT-4o...
          </div>
        )}

        <div className="overflow-x-auto -mx-5">
          <table className="skills-editor-table min-w-[860px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3 w-[120px]">Type</th>
                <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3">Skill Name</th>
                <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3 w-[130px]">Importance</th>
                <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3">Subtopics (comma-separated)</th>
                <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-5 py-3 w-[180px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {skillCards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-slate-400 text-sm">
                    No skills yet. Run extraction or add one manually.
                  </td>
                </tr>
              ) : (
                skillCards.map((card) => (
                  <tr key={card.local_id || card.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors last:border-0">
                    <td className="px-5 py-3 w-[120px]">
                      {card.isEditing && card.isNew ? (
                        <select
                          value={card.skill_type}
                          onChange={(event) => updateCardField(card.local_id, 'skill_type', event.target.value)}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700"
                        >
                          <option value="primary">primary</option>
                          <option value="secondary">secondary</option>
                          <option value="soft">soft</option>
                        </select>
                      ) : (
                        <Badge variant={getSkillTypeVariant(card.skill_type)}>{card.skill_type || 'secondary'}</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {card.isEditing ? (
                        <input
                          type="text"
                          value={card.skill_name}
                          onChange={(event) => updateCardField(card.local_id, 'skill_name', event.target.value)}
                          placeholder="Skill name"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[140px]"
                        />
                      ) : (
                        <div className="text-sm text-slate-800 font-medium whitespace-nowrap overflow-hidden text-ellipsis">{card.skill_name || '-'}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 w-[130px]">
                      {card.isEditing ? (
                        <input
                          type="text"
                          value={card.importance_level || ''}
                          onChange={(event) => updateCardField(card.local_id, 'importance_level', event.target.value)}
                          placeholder="Optional"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[100px]"
                        />
                      ) : (
                        <div className="text-sm text-slate-600">{card.importance_level || '-'}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {card.isEditing ? (
                        <input
                          type="text"
                          value={card.subtopics_text}
                          onChange={(event) => updateCardField(card.local_id, 'subtopics_text', event.target.value)}
                          placeholder="Node.js, Express, API Design"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]"
                        />
                      ) : (
                        <div className="text-sm text-slate-600 whitespace-nowrap overflow-hidden text-ellipsis">{card.subtopics_text || '-'}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 w-[180px]">
                      <div className="flex items-center gap-1.5">
                        {card.isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSaveCard(card.local_id)}
                              disabled={savingRowId === card.local_id}
                              className="text-xs bg-[#02c0fa] hover:bg-[#00a8e0] text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                              {savingRowId === card.local_id ? (
                                <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full spin" />Saving...</>
                              ) : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelEdit(card.local_id)}
                              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEditCard(card.local_id)}
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteCard(card.local_id)}
                          className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pt-4 mt-2 border-t border-slate-100">
          <SecondaryBtn onClick={handleAddManualSkill}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Skill Manually
          </SecondaryBtn>
        </div>
      </Card>
    </AppShell>
  )
}
