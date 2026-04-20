import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
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

function getSkillTypeClass(skillType) {
  if (skillType === 'primary') return 'skill-type-pill skill-type-pill-primary'
  if (skillType === 'soft') return 'skill-type-pill skill-type-pill-soft'
  return 'skill-type-pill skill-type-pill-secondary'
}

export default function SkillExtraction() {
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

        console.log('[SkillExtraction] Initial load', {
          jdId,
          jd: jdResponse.data?.jd,
          rawTextLength: (jdResponse.data?.jd?.raw_text || '').length,
          skillsCount: (skillsResponse.data?.skills || []).length,
        })

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

      console.log('[SkillExtraction] Extract request', {
        jdId,
        rawTextLength: (jd?.raw_text || '').length,
      })

      await extractSkills(jdId)
      const skillsResponse = await getSkills(jdId)
      const refreshedSkills = skillsResponse.data?.skills ?? []

      console.log('[SkillExtraction] Extract response', {
        jdId,
        skillsCount: refreshedSkills.length,
        skills: refreshedSkills,
      })

      setSkillCards(refreshedSkills.map(buildCard))
      setSuccess('Skills extracted successfully.')
    } catch (extractError) {
      console.error('[SkillExtraction] Extract failed', {
        jdId,
        status: extractError?.response?.status,
        data: extractError?.response?.data,
      })
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

      console.log('[SkillExtraction] Upload request', {
        jdId,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
      })

      const uploadResponse = await uploadJDFile(jdId, selectedFile)
      console.log('[SkillExtraction] Upload response', {
        jdId,
        data: uploadResponse.data,
      })

      const jdResponse = await getJD(jdId)
      console.log('[SkillExtraction] JD after upload', {
        jdId,
        jd: jdResponse.data?.jd,
        rawTextLength: (jdResponse.data?.jd?.raw_text || '').length,
      })

      setJD(jdResponse.data?.jd ?? null)

      if ((jdResponse.data?.jd?.raw_text || '').trim().length === 0) {
        setError('Upload succeeded, but no readable text was extracted from this file. Try a different file format/layout.')
        return
      }

      setSuccess('JD file uploaded. You can now extract skills.')
      setSelectedFile(null)
    } catch (uploadError) {
      console.error('[SkillExtraction] Upload failed', {
        jdId,
        status: uploadError?.response?.status,
        data: uploadError?.response?.data,
      })
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
          fillColor: [24, 95, 165],
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
      <AppShell>
        <div className="loading-state">
          <div className="loading-spinner" aria-label="Loading skill extraction" />
          <span>Loading JD details...</span>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="topbar">
        <h1>Skill Extraction</h1>
      </div>

      {error ? <div className="login-error">{error}</div> : null}
      {success ? <div className="card section-copy section-copy-left">{success}</div> : null}

      <div className="card">
        <div className="card-title">JD Details</div>
        <p className="report-copy"><strong>Title:</strong> {jd?.title || '-'}</p>
        <p className="report-copy"><strong>Raw text preview:</strong> {rawPreview || 'No raw text available.'}</p>
        <p className="report-copy"><strong>Raw text length:</strong> {(jd?.raw_text || '').length}</p>
        <div className="raw-text-viewer">
          {(jd?.raw_text && jd.raw_text.trim()) ? jd.raw_text : 'No raw text available.'}
        </div>
        {(!jd?.raw_text || !jd.raw_text.trim()) ? (
          <div className="form-group">
            <label className="form-label" htmlFor="jd-upload">Upload JD (.pdf/.docx)</label>
            <input
              id="jd-upload"
              type="file"
              accept=".pdf,.docx"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
            <div className="topbar-actions" style={{ marginTop: '8px' }}>
              <button
                className="btn"
                type="button"
                onClick={handleUploadJDFile}
                disabled={isUploading}
              >
                {isUploading ? 'Uploading...' : 'Upload File'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card skill-panel-card">
        <div className="topbar skill-topbar">
          <div className="card-title skill-title-no-margin">Extracted Skills</div>
          <div className="topbar-actions">
            <button
              className="btn"
              disabled={isExtracting || isDownloadingExcel || skillCards.length === 0}
              onClick={handleDownloadExcel}
              type="button"
            >
              {isDownloadingExcel ? 'Downloading...' : 'Download Excel'}
            </button>
            <button
              className="btn"
              disabled={isExtracting || isDownloadingPdf || skillCards.length === 0}
              onClick={handleDownloadPdf}
              type="button"
            >
              {isDownloadingPdf ? 'Downloading...' : 'Download PDF'}
            </button>
            <button className="btn btn-primary" disabled={isExtracting} onClick={handleExtract} type="button">
              {isExtracting ? 'Analysing JD with GPT-4o...' : 'Extract Skills'}
            </button>
          </div>
        </div>

        <div className="skill-panel-scroll">
          {isExtracting ? (
            <div className="loading-state">
              <div className="loading-spinner" aria-label="Extracting skills" />
              <span>Analysing JD with GPT-4o...</span>
            </div>
          ) : null}

          <div className="skills-editor-table-wrap">
            <table className="skills-editor-table" >
              <thead >
                <tr>
                  <th>Type</th>
                  <th>Skill Name</th>
                  <th>Importance</th>
                  <th>Subtopics (comma-separated)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {skillCards.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="skills-empty-row">
                      No skills yet. Run extraction or add one manually.
                    </td>
                  </tr>
                ) : (
                  skillCards.map((card) => (
                    <tr key={card.local_id || card.id} className="skills-editor-row">
                      <td className="skills-type-cell">
                        {card.isEditing && card.isNew ? (
                          <select
                            value={card.skill_type}
                            onChange={(event) => updateCardField(card.local_id, 'skill_type', event.target.value)}
                          >
                            <option value="primary">primary</option>
                            <option value="secondary">secondary</option>
                          </select>
                        ) : (
                          <span className={getSkillTypeClass(card.skill_type)}>{card.skill_type || 'secondary'}</span>
                        )}
                      </td>
                      <td>
                        {card.isEditing ? (
                          <input
                            type="text"
                            value={card.skill_name}
                            onChange={(event) => updateCardField(card.local_id, 'skill_name', event.target.value)}
                            placeholder="Skill name"
                          />
                        ) : (
                          <div className="skills-readonly-cell">{card.skill_name || '-'}</div>
                        )}
                      </td>
                      <td>
                        {card.isEditing ? (
                          <input
                            type="text"
                            value={card.importance_level || ''}
                            onChange={(event) => updateCardField(card.local_id, 'importance_level', event.target.value)}
                            placeholder="Optional"
                          />
                        ) : (
                          <div className="skills-readonly-cell">{card.importance_level || '-'}</div>
                        )}
                      </td>
                      <td>
                        {card.isEditing ? (
                          <input
                            type="text"
                            value={card.subtopics_text}
                            onChange={(event) => updateCardField(card.local_id, 'subtopics_text', event.target.value)}
                            placeholder="Node.js, Express, API Design"
                          />
                        ) : (
                          <div className="skills-readonly-cell">{card.subtopics_text || '-'}</div>
                        )}
                      </td>
                      <td className="skills-actions-cell">
                        {card.isEditing ? (
                          <>
                            <button
                              className="btn btn-primary table-action-btn"
                              onClick={() => handleSaveCard(card.local_id)}
                              type="button"
                              disabled={savingRowId === card.local_id}
                            >
                              {savingRowId === card.local_id ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              className="btn table-action-btn"
                              onClick={() => handleCancelEdit(card.local_id)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn table-action-btn"
                            onClick={() => handleEditCard(card.local_id)}
                            type="button"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          className="btn btn-danger table-action-btn"
                          onClick={() => handleDeleteCard(card.local_id)}
                          type="button"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="topbar-actions skill-panel-footer">
            <button className="btn" onClick={handleAddManualSkill} type="button">
              Add Skill Manually
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
